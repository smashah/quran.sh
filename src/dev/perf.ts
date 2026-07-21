import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { collectPerformanceReport, performanceReportMarkdown } from "../features/performance/report.ts";

const root = resolve(import.meta.dir, "../..");
const report = await collectPerformanceReport(root);
const output = resolve(root, "artifacts", "performance");
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(resolve(output, "latest.json"), `${JSON.stringify(report, null, 2)}\n`),
  writeFile(resolve(output, "latest.md"), performanceReportMarkdown(report)),
]);
console.log(performanceReportMarkdown(report));

if (report.probes.some((probe) => probe.status === "fail")) process.exitCode = 1;
