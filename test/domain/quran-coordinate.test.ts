import { describe, expect, test } from "bun:test";
import {
  alignWordSequences,
  auditCoordinateCoverage,
  makeVerseKey,
  makeWordKey,
  normalizeArabicForAlignment,
  parseVerseKey,
  parseWordKey,
  QURAN_VERSE_COUNTS,
} from "../../src/domain/quran-coordinate.ts";

describe("Quran coordinates", () => {
  test("round-trips verse and word keys", () => {
    expect(makeVerseKey(2, 255)).toBe("2:255");
    expect(parseVerseKey("2:255")).toEqual({ surah: 2, ayah: 255, key: "2:255" });
    expect(makeWordKey(1, 1, 3)).toBe("1:1:3");
    expect(parseWordKey("1:1:3")).toEqual({ surah: 1, ayah: 1, word: 3, key: "1:1:3" });
  });

  test("rejects invalid and out-of-range coordinates", () => {
    for (const value of ["", "0:1", "115:1", "1:0", "1:8", "1:1:1", "x:1"]) {
      expect(parseVerseKey(value)).toBeNull();
    }
    for (const value of ["1:1", "1:1:0", "0:1:1", "1:x:1", "1:1:1:1"]) {
      expect(parseWordKey(value)).toBeNull();
    }
  });

  test("covers the complete 6,236-ayah canon", () => {
    expect(QURAN_VERSE_COUNTS).toHaveLength(114);
    expect(QURAN_VERSE_COUNTS.reduce((sum, count) => sum + count, 0)).toBe(6_236);
    const keys = QURAN_VERSE_COUNTS.flatMap((count, surah) => Array.from({ length: count }, (_, ayah) => makeVerseKey(surah + 1, ayah + 1)));
    expect(new Set(keys).size).toBe(6_236);
    expect(keys.at(-1)).toBe("114:6");
  });

  test("normalizes Quran marks without changing letter order", () => {
    expect(normalizeArabicForAlignment("ٱلرَّحْمَـٰنِ")).toBe("الرحمن");
    expect(normalizeArabicForAlignment("بِسْمِ ٱللَّهِ")).toBe("بسمالله");
  });

  test("aligns exact and joined token sequences explicitly", () => {
    expect(alignWordSequences(["بسم", "الله"], ["بِسْمِ", "ٱللَّهِ"])).toEqual({
      status: "aligned",
      mappings: [
        { source: [0], target: [0] },
        { source: [1], target: [1] },
      ],
    });

    expect(alignWordSequences(["عبد", "الله"], ["عبدالله"])).toEqual({
      status: "aligned",
      mappings: [{ source: [0, 1], target: [0] }],
    });
  });

  test("reports the first ambiguous region instead of shifting later words", () => {
    expect(alignWordSequences(["الرحمن", "الرحيم"], ["الرحمن", "ملك"])).toEqual({
      status: "ambiguous",
      sourceIndex: 1,
      targetIndex: 1,
    });
  });

  test("audits missing, duplicate, and invalid imported coordinates", () => {
    expect(auditCoordinateCoverage(["1:1:1", "1:1:2", "1:2:1"], ["1:1", "1:2"])).toMatchObject({ ok: true, verseCount: 2, wordCount: 3 });
    expect(auditCoordinateCoverage(["1:1:1", "1:1:1", "bad"], ["1:1", "1:2"])).toMatchObject({
      ok: false, missingVerses: ["1:2"], duplicateWords: ["1:1:1"], invalidWords: ["bad"],
    });
  });
});
