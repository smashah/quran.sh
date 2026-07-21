import { readdir, stat } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { join } from "node:path";
import { PERFORMANCE_BUDGETS, type PerformanceBudgetId } from "./budgets.ts";

export interface ProbeResult {
  readonly id: PerformanceBudgetId;
  readonly value: number;
  readonly status: "pass" | "warning" | "fail";
}

export interface PerformanceReport {
  readonly generatedAt: string;
  readonly runtime: { bun: string; platform: string; release: string; arch: string };
  readonly mode: "source" | "bundle";
  readonly probes: readonly ProbeResult[];
}

export function evaluateProbe(id: PerformanceBudgetId, value: number): ProbeResult {
  const budget = PERFORMANCE_BUDGETS[id];
  return {
    id,
    value,
    status: value > budget.blocking ? "fail" : value > budget.warning ? "warning" : "pass",
  };
}

async function timed(command: string[]): Promise<number> {
  const start = Bun.nanoseconds();
  const process = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
  const exitCode = await process.exited;
  if (exitCode !== 0) throw new Error(`${command.join(" ")} exited ${exitCode}`);
  return (Bun.nanoseconds() - start) / 1_000_000;
}

export function parsePeakRss(stderr: string, os: string): number | null {
  if (os === "darwin") {
    const match = stderr.match(/(\d+)\s+maximum resident set size/i);
    return match ? Number(match[1]) : null;
  }
  const match = stderr.match(/Maximum resident set size \(kbytes\):\s*(\d+)/i);
  return match ? Number(match[1]) * 1024 : null;
}

async function peakRss(command: string[]): Promise<number | null> {
  if (!await Bun.file("/usr/bin/time").exists()) return null;
  const os = platform();
  const child = Bun.spawn(["/usr/bin/time", os === "darwin" ? "-l" : "-v", ...command], { stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(child.stderr).text();
  if (await child.exited !== 0) throw new Error(`${command.join(" ")} failed during RSS probe`);
  return parsePeakRss(stderr, os);
}

export async function collectPerformanceReport(root = process.cwd()): Promise<PerformanceReport> {
  const entry = join(root, "dist", "index.js");
  const entrySize = (await stat(entry)).size;
  const wallSamples = await Promise.all(Array.from({ length: 5 }, () => timed(["bun", entry, "--help"])));
  wallSamples.sort((a, b) => a - b);
  const rss = await peakRss(["bun", entry, "--help"]);
  const dist = join(root, "dist");
  const packageJsBytes = (await readdir(dist)).filter((file) => file.endsWith(".js"))
    .reduce(async (total, file) => await total + (await stat(join(dist, file))).size, Promise.resolve(0));
  const binaryPath = join(dist, "quran");
  const binaryBytes = await stat(binaryPath).then((value) => value.size).catch(() => null);
  const { createFeatureRuntime } = await import("../runtime.ts");
  let retained: Uint8Array | null = null;
  const runtime = createFeatureRuntime({
    probe: { async load() { retained = new Uint8Array(16 * 1024 * 1024); retained.fill(1); return { value: true, dispose: () => { retained = null; } }; } },
  });
  await runtime.activate("probe");
  await runtime.disable("probe");
  Bun.gc(true);
  const before = process.memoryUsage.rss();
  let cleanupLatency = 0;
  for (let cycle = 0; cycle < 20; cycle += 1) {
    await runtime.activate("probe");
    const started = Bun.nanoseconds();
    await runtime.disable("probe");
    cleanupLatency = Math.max(cleanupLatency, (Bun.nanoseconds() - started) / 1_000_000);
  }
  await runtime.shutdown();
  Bun.gc(true);
  const fakePostUnloadRssDelta = Math.max(0, process.memoryUsage.rss() - before);

  return {
    generatedAt: new Date().toISOString(),
    runtime: { bun: Bun.version, platform: platform(), release: release(), arch: arch() },
    mode: "bundle",
    probes: [
      evaluateProbe("helpWallTime", wallSamples[2]!),
      evaluateProbe("startupChunk", entrySize),
      evaluateProbe("packageJsBytes", await packageJsBytes),
      ...(binaryBytes === null ? [] : [evaluateProbe("binaryBytes", binaryBytes)]),
      evaluateProbe("cleanupLatency", cleanupLatency),
      evaluateProbe("fakePostUnloadRssDelta", fakePostUnloadRssDelta),
      ...(rss === null ? [] : [evaluateProbe("helpPeakRss", rss)]),
    ],
  };
}

export function performanceReportMarkdown(report: PerformanceReport): string {
  const rows = report.probes.map((probe) => {
    const budget = PERFORMANCE_BUDGETS[probe.id];
    return `| ${probe.id} | ${probe.value.toFixed(2)} ${budget.unit} | ${budget.blocking} ${budget.unit} | ${probe.status} |`;
  });
  return [
    "# quran.sh performance report",
    "",
    `Bun ${report.runtime.bun} · ${report.runtime.platform} ${report.runtime.arch} · ${report.mode}`,
    "",
    "| Probe | Result | Blocking budget | Status |",
    "|---|---:|---:|---|",
    ...rows,
    "",
  ].join("\n");
}
