import { stat } from "node:fs/promises";
import { join } from "node:path";
import { APP_DATA_DIR } from "../data/db.ts";

async function pathSize(path: string): Promise<number> {
  try {
    const entry = await stat(path);
    if (entry.isFile()) return entry.size;
    const glob = new Bun.Glob("**/*");
    let bytes = 0;
    for await (const relative of glob.scan({ cwd: path, onlyFiles: true })) bytes += (await stat(join(path, relative))).size;
    return bytes;
  } catch { return 0; }
}

function packageAvailable(name: string): boolean {
  try { Bun.resolveSync(name, import.meta.dir); return true; } catch { return false; }
}

export async function runDoctor(args: string[]): Promise<number> {
  const [{ createResourcePackManager }, { ayahImageCacheStats }] = await Promise.all([
    import("./resources/manager.ts"),
    import("../tui/utils/ayah-image.ts"),
  ]);
  const packs = await createResourcePackManager(join(APP_DATA_DIR, "resources")).list();
  const packBytes = await pathSize(join(APP_DATA_DIR, "resources"));
  const modelBytes = await pathSize(join(APP_DATA_DIR, "models", "tilawa"));
  const webGpu = args.includes("--gpu")
    ? await (async () => {
      const [{ detectWebGpuCapability }, { diagnoseWebGpuFailure }] = await Promise.all([
        import("./spatial/three-backdrop.ts"),
        import("./spatial/diagnostics.ts"),
      ]);
      const result = await detectWebGpuCapability();
      return result.supported
        ? { status: "available" as const }
        : { status: "unavailable" as const, reason: result.reason, diagnosis: diagnoseWebGpuFailure(result.reason) };
    })()
    : { status: "not-probed" as const, command: "quran doctor --gpu" };
  const report = {
    quranSh: (await import("../../package.json")).version,
    bun: Bun.version,
    platform: `${process.platform}-${process.arch}`,
    capabilities: {
      textReader: true,
      splitFooter: true,
      brailleImages: true,
      playback: true,
      ffmpegMicrophone: Boolean(Bun.which("ffmpeg")),
      tilawaCore: packageAvailable("@tilawa/core"),
      onnxRuntime: packageAvailable("onnxruntime-node"),
      openTuiThree: packageAvailable("@opentui/three"),
      webGpu,
      spatialEnabledByDefault: false,
    },
    storage: { packs: packs.length, packBytes, tilawaModelBytes: modelBytes, imageMemoryCache: ayahImageCacheStats() },
    resources: packs.map((pack) => ({
      id: pack.manifest.id,
      version: pack.manifest.version,
      kind: pack.manifest.kind,
      license: pack.manifest.license.name,
      attribution: pack.manifest.license.attribution,
      redistribution: pack.manifest.license.redistribution,
    })),
    privacy: { telemetry: false, microphoneRetention: false, networkAtStartup: false },
  };
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`quran.sh ${report.quranSh} · Bun ${report.bun} · ${report.platform}`);
    for (const [name, available] of Object.entries(report.capabilities)) {
      if (name === "webGpu") continue;
      console.log(`${available ? "✓" : "·"} ${name}`);
    }
    console.log(`${webGpu.status === "available" ? "✓" : "·"} webGpu · ${webGpu.status}`);
    if (webGpu.status === "unavailable") {
      console.log(`  ${webGpu.diagnosis.summary}`);
      for (const step of webGpu.diagnosis.steps) console.log(`  - ${step}`);
    } else if (webGpu.status === "not-probed") console.log(`  Probe on demand with: ${webGpu.command}`);
    console.log(`\nResources: ${packs.length} pack(s), ${packBytes} bytes · Tilawa assets: ${modelBytes} bytes`);
    for (const resource of report.resources) console.log(`- ${resource.id}@${resource.version} · ${resource.kind} · ${resource.license} · ${resource.attribution}`);
    console.log("\nNo telemetry. Microphone PCM stays local and is not retained by default.");
  }
  return 0;
}
