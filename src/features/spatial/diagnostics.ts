export interface WebGpuDiagnosis {
  readonly summary: string;
  readonly steps: readonly string[];
}

export function diagnoseWebGpuFailure(
  reason: string,
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
): WebGpuDiagnosis {
  const normalized = reason.toLowerCase();
  const supportedArchitecture = architecture === "x64" || (platform === "darwin" && architecture === "arm64");
  if (!supportedArchitecture || normalized.includes("not supported on the current platform")) {
    return {
      summary: `The optional WebGPU runtime has no native build for ${platform}-${architecture}.`,
      steps: [
        "Use the terminal-cell illumination fallback in this dialog.",
        "For the 3D backdrop, run quran.sh on macOS x64/arm64, Linux x64, or Windows x64.",
      ],
    };
  }
  if (normalized.includes("cannot find") || normalized.includes("module") || normalized.includes("package")) {
    return {
      summary: "The optional native WebGPU package is missing or was omitted during installation.",
      steps: ["Run `bun install` with optional dependencies enabled.", "Then run `quran doctor --gpu` and retry spatial mode."],
    };
  }
  if (platform === "linux") {
    return {
      summary: "WebGPU could not create a device from the Linux graphics stack.",
      steps: [
        "Update the Vulkan-capable GPU driver and verify it with `vulkaninfo --summary`.",
        "Headless containers and SSH sessions need GPU device access; otherwise use terminal illumination.",
      ],
    };
  }
  if (platform === "win32") {
    return {
      summary: "WebGPU could not create a D3D12 device.",
      steps: ["Update the Windows GPU driver; WSL also needs current WSLg support.", "Run `quran doctor --gpu`, or use terminal illumination."],
    };
  }
  if (platform === "darwin") {
    const deviceFailure = normalized.includes("device")
      || normalized.includes("adapter")
      || normalized.includes("metal")
      || normalized.includes("surface");
    return {
      summary: deviceFailure
        ? `OpenTUI Three could not create its Metal/WebGPU renderer: ${reason}`
        : `OpenTUI Three failed after the Metal device probe: ${reason}`,
      steps: ["Run `quran doctor --gpu` to separate device availability from renderer startup.", "Retry outside a headless service or remote session, or use terminal illumination."],
    };
  }
  return {
    summary: `WebGPU device creation failed: ${reason}`,
    steps: ["Run `quran doctor --gpu` for the active capability probe.", "Use terminal illumination when this machine has no compatible GPU path."],
  };
}
