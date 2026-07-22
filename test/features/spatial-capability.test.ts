import { describe, expect, test } from "bun:test";
import { detectWebGpuCapability, THREE_BACKDROP_LAYOUT } from "../../src/features/spatial/three-backdrop.ts";

describe("OpenTUI Three capability gate", () => {
  test("accepts a device and releases the probe immediately", async () => {
    let destroyed = 0;
    let initialized = 0;
    expect(await detectWebGpuCapability(
      async () => ({ destroy: () => { destroyed += 1; } }),
      async () => { initialized += 1; },
    )).toEqual({ supported: true });
    expect(initialized).toBe(1);
    expect(destroyed).toBe(1);
  });

  test("turns device failure into a local capability result", async () => {
    expect(await detectWebGpuCapability(async () => { throw new Error("adapter missing"); })).toEqual({ supported: false, reason: "adapter missing" });
  });

  test("composes the GPU surface as a bounded foreground without entering reader layout", () => {
    expect(THREE_BACKDROP_LAYOUT).toMatchObject({ position: "absolute", top: 3, bottom: 8, left: 0, width: "100%" });
    expect(THREE_BACKDROP_LAYOUT.zIndex).toBeGreaterThan(0);
  });
});
