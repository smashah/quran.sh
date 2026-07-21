import { describe, expect, test } from "bun:test";
import { getVerse } from "../../src/data/quran.ts";
import { applyStrategy, wrapAndReverse } from "../../src/tui/utils/rtl.ts";
import { chooseReaderLayout } from "../../src/tui/responsive.ts";

const FIXTURES = ["1:1", "1:7", "2:255", "22:18", "55:13", "96:1"] as const;

describe("Arabic and RTL regression matrix", () => {
  for (const verseKey of FIXTURES) {
    test(`${verseKey} preserves every code point in raw mode`, () => {
      const text = getVerse(verseKey)!.text;
      for (const width of [20, 31, 32, 71, 72, 119, 120]) {
        expect(applyStrategy(text, "raw", width), `${verseKey} at width ${width}`).toBe(text);
      }
    });

    test(`${verseKey} wraps reversed lines without losing word content`, () => {
      const text = getVerse(verseKey)!.text;
      for (const width of [20, 31, 32, 71, 72]) {
        const reconstructed = wrapAndReverse(text, width)
          .split("\n")
          .map((line) => [...line].reverse().join(""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        expect(reconstructed, `${verseKey} at width ${width}`).toBe(text.replace(/\s+/g, " ").trim());
      }
    });
  }

  test("breakpoint edges always retain a Quran text surface", () => {
    for (const width of [20, 71, 72, 119, 120, 200]) {
      const layout = chooseReaderLayout(width, 32);
      expect(layout.mode).toMatch(/compact|standard|immersive/);
      if (width < 72) expect(layout.showDecoration).toBe(false);
    }
  });
});
