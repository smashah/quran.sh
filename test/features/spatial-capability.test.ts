import { describe, expect, test } from "bun:test";
import { detectWebGpuCapability } from "../../src/features/spatial/three-backdrop.ts";

describe("OpenTUI Three capability gate", () => {
  test("accepts a device and releases the probe immediately", async () => {
    let destroyed = 0;
    expect(await detectWebGpuCapability(async () => ({ destroy: () => { destroyed += 1; } }))).toEqual({ supported: true });
    expect(destroyed).toBe(1);
  });

  test("turns device failure into a local capability result", async () => {
    expect(await detectWebGpuCapability(async () => { throw new Error("adapter missing"); })).toEqual({ supported: false, reason: "adapter missing" });
  });
});
