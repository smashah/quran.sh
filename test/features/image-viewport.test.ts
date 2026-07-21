import { describe, expect, test } from "bun:test";
import { DEFAULT_IMAGE_VIEWPORT, dragImageViewport, updateImageViewport, viewportBounds } from "../../src/features/images/viewport.ts";

describe("ayah image viewport", () => {
  test("zooms around a bounded pan point", () => {
    let viewport = updateImageViewport(DEFAULT_IMAGE_VIEWPORT, "zoom-in");
    viewport = updateImageViewport(viewport, "right");
    const bounds = viewportBounds({ minX: 0, maxX: 999, minY: 0, maxY: 499 }, viewport);
    expect(bounds.maxX - bounds.minX).toBeLessThan(999);
    expect(bounds.minX).toBeGreaterThan(0);
  });

  test("clamps zoom and resets pan when fully zoomed out", () => {
    let viewport = { zoom: 8, panX: 0.5, panY: -0.5 };
    for (let index = 0; index < 20; index++) viewport = updateImageViewport(viewport, "zoom-out");
    expect(viewport).toEqual(DEFAULT_IMAGE_VIEWPORT);
  });

  test("maps mouse drag to bounded pan only while zoomed", () => {
    expect(dragImageViewport(DEFAULT_IMAGE_VIEWPORT, 20, 20)).toEqual(DEFAULT_IMAGE_VIEWPORT);
    expect(dragImageViewport({ zoom: 2, panX: 0, panY: 0 }, 10, -10)).toEqual({ zoom: 2, panX: -0.1, panY: 0.1 });
    expect(dragImageViewport({ zoom: 2, panX: 0.49, panY: -0.49 }, -100, 100)).toEqual({ zoom: 2, panX: 0.5, panY: -0.5 });
  });
});
