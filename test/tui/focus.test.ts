import { describe, expect, test } from "bun:test";
import { focusReducer, regionOf, stepRegion, visiblePanes, visibleRegions } from "../../src/tui/focus.ts";

describe("pane focus", () => {
  test("cycles only through visible panes", () => {
    const visibility = {
      showSidebar: true,
      showArabic: false,
      showTranslation: true,
      showTransliteration: false,
      showPanel: true,
    };

    expect(visiblePanes(visibility)).toEqual(["sidebar", "translation", "panel"]);
    expect(focusReducer("sidebar", { type: "cycle", visibility })).toBe("translation");
    expect(focusReducer("translation", { type: "cycle", visibility })).toBe("panel");
    expect(focusReducer("panel", { type: "cycle", visibility })).toBe("sidebar");
  });

  test("recovers when the currently focused pane is hidden", () => {
    const visibility = {
      showSidebar: false,
      showArabic: false,
      showTranslation: true,
      showTransliteration: false,
      showPanel: false,
    };

    expect(focusReducer("arabic", { type: "cycle", visibility })).toBe("translation");
  });

  test("Tab moves between areas and Shift+Tab goes back", () => {
    const visibility = {
      showSidebar: true,
      showArabic: true,
      showTranslation: true,
      showTransliteration: true,
      showPanel: true,
    };
    expect(visibleRegions(visibility)).toEqual(["surahs", "stats", "reader", "panel"]);
    expect(stepRegion("surahs", visibility, 1)).toBe("stats");
    expect(stepRegion("stats", visibility, 1)).toBe("reader");
    expect(stepRegion("reader", visibility, 1)).toBe("panel");
    expect(stepRegion("panel", visibility, 1)).toBe("surahs");
    expect(stepRegion("surahs", visibility, -1)).toBe("panel");
    expect(stepRegion("reader", visibility, -1)).toBe("stats");
    expect(regionOf("translation", "surahList")).toBe("reader");
    expect(regionOf("sidebar", "stats")).toBe("stats");
  });

  test("hidden areas are skipped", () => {
    const visibility = {
      showSidebar: false,
      showArabic: true,
      showTranslation: false,
      showTransliteration: false,
      showPanel: false,
    };
    expect(visibleRegions(visibility)).toEqual(["reader"]);
    expect(stepRegion("surahs", visibility, 1)).toBe("reader");
  });
});
