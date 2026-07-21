import { describe, expect, test } from "bun:test";
import { focusReducer, visiblePanes } from "../../src/tui/focus.ts";

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
});
