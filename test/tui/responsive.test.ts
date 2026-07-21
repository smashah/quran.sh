import { describe, expect, test } from "bun:test";
import { chooseReaderLayout, preserveReaderAnchor, readerTransitionDuration } from "../../src/tui/responsive.ts";

describe("responsive reader policy", () => {
  test("degrades optional panels before Quran text", () => {
    expect(chooseReaderLayout(71, 30).mode).toBe("compact");
    expect(chooseReaderLayout(72, 30).mode).toBe("standard");
    expect(chooseReaderLayout(119, 40).mode).toBe("standard");
    expect(chooseReaderLayout(120, 32).mode).toBe("immersive");
    expect(chooseReaderLayout(50, 10).showAuxiliaryPanel).toBe(false);
  });

  test("preserves semantic position across breakpoints", () => {
    const anchor = { verseKey: "2:255", focus: "arabic", zoom: 2 } as const;
    expect(preserveReaderAnchor(anchor, chooseReaderLayout(60, 20))).toEqual(anchor);
  });

  test("reduced motion commits immediately while normal focus transitions stay restrained", () => {
    expect(readerTransitionDuration(false)).toBe(180);
    expect(readerTransitionDuration(true)).toBe(0);
  });
});
