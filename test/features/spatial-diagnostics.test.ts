import { describe, expect, test } from "bun:test";
import { diagnoseWebGpuFailure } from "../../src/features/spatial/diagnostics.ts";

describe("WebGPU recovery guidance", () => {
  test("routes unsupported architectures to the always-available fallback", () => {
    const result = diagnoseWebGpuFailure("bun-webgpu is not supported on the current platform", "linux", "arm64");
    expect(result.summary).toContain("linux-arm64");
    expect(result.steps.join(" ")).toContain("terminal-cell illumination");
  });

  test("gives Linux adapter failures a concrete Vulkan check", () => {
    const result = diagnoseWebGpuFailure("No adapter was found", "linux", "x64");
    expect(result.steps.join(" ")).toContain("vulkaninfo --summary");
  });

  test("identifies missing optional dependencies", () => {
    const result = diagnoseWebGpuFailure("Cannot find module bun-webgpu", "darwin", "arm64");
    expect(result.steps.join(" ")).toContain("bun install");
  });
});
