/**
 * Tests for visual width calculation of Arabic/Quranic text.
 *
 * Verifies that combining marks (tashkeel), zero-width characters,
 * and BiDi control characters are correctly excluded from width counts.
 */
import { describe, expect, test } from "bun:test";
import { getVisualWidth, isZeroWidth } from "../../src/tui/utils/rtl";

describe("getVisualWidth", () => {
  test("plain ASCII has width equal to length", () => {
    expect(getVisualWidth("hello")).toBe(5);
    expect(getVisualWidth("")).toBe(0);
    expect(getVisualWidth(" ")).toBe(1);
  });

  test("Arabic base letters each occupy 1 column", () => {
    // "بسم" — 3 base letters (ba, sin, meem)
    expect(getVisualWidth("بسم")).toBe(3);
  });

  test("Arabic letters with tashkeel: combining marks are zero-width", () => {
    // "بِسْمِ" — ba+kasra, sin+sukun, meem+kasra = 3 base + 3 combining = width 3
    expect(getVisualWidth("بِسْمِ")).toBe(3);
  });

  test("Basmala from quran-json (Uthmani with full tashkeel)", () => {
    const basmala = "بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ";
    // Count base characters manually:
    // بـ سـ مـ (space) اـ لـ لـ هـ (space) اـ لـ رـ حـ مـ نـ (space) اـ لـ رـ حـ يـ مـ
    // = 3 + 1 + 4 + 1 + 6 + 1 + 6 = 22 (letters + spaces)
    // All tashkeel (kasra, fatha, shadda, sukun, superscript alef) are zero-width
    const width = getVisualWidth(basmala);
    // Let's verify by counting non-combining codepoints
    let expected = 0;
    for (const ch of basmala) {
      if (!isZeroWidth(ch.codePointAt(0)!)) expected++;
    }
    expect(width).toBe(expected);
    // Sanity: width should be much less than string length due to combining marks
    expect(width).toBeLessThan([...basmala].length);
  });

  test("superscript alef (U+0670) is zero-width", () => {
    // ٰ  — superscript alef, appears in ٱلرَّحۡمَٰنِ
    expect(isZeroWidth(0x0670)).toBe(true);
  });

  test("Quranic stop signs are zero-width combining marks", () => {
    // U+06D6 (small high ligature sad with lam alef)
    expect(isZeroWidth(0x06d6)).toBe(true);
    // U+06DC (small high seen)
    expect(isZeroWidth(0x06dc)).toBe(true);
  });

  test("small high meem sukun (U+06E1) is zero-width", () => {
    // ۡ — used for sukun in Uthmani script
    expect(isZeroWidth(0x06e1)).toBe(true);
  });

  test("BiDi control characters are zero-width", () => {
    expect(isZeroWidth(0x200e)).toBe(true); // LRM
    expect(isZeroWidth(0x200f)).toBe(true); // RLM
    expect(isZeroWidth(0x202a)).toBe(true); // LRE
    expect(isZeroWidth(0x202b)).toBe(true); // RLE
    expect(isZeroWidth(0x202c)).toBe(true); // PDF
    expect(isZeroWidth(0x202d)).toBe(true); // LRO
    expect(isZeroWidth(0x202e)).toBe(true); // RLO
    expect(isZeroWidth(0x2066)).toBe(true); // LRI
    expect(isZeroWidth(0x2067)).toBe(true); // RLI
    expect(isZeroWidth(0x2069)).toBe(true); // PDI
  });

  test("zero-width joiners are zero-width", () => {
    expect(isZeroWidth(0x200c)).toBe(true); // ZWNJ
    expect(isZeroWidth(0x200d)).toBe(true); // ZWJ
    expect(isZeroWidth(0x200b)).toBe(true); // ZWSP
  });

  test("tatweel/kashida (U+0640) is NOT zero-width", () => {
    expect(isZeroWidth(0x0640)).toBe(false);
  });

  test("Rub el Hizb (U+06DE) is NOT zero-width", () => {
    // ۞ — section marker, standalone glyph
    expect(isZeroWidth(0x06de)).toBe(false);
  });

  test("thin space (U+2009) is NOT zero-width (occupies 1 column)", () => {
    expect(isZeroWidth(0x2009)).toBe(false);
  });

  test("text wrapped with RLM markers has same visual width as without", () => {
    const base = "بسم";
    const withRLM = "\u200F" + base + "\u200F";
    expect(getVisualWidth(withRLM)).toBe(getVisualWidth(base));
  });

  test("text wrapped with RLO/PDF has same visual width as without", () => {
    const base = "بسم";
    const withRLO = "\u202E" + base + "\u202C";
    expect(getVisualWidth(withRLO)).toBe(getVisualWidth(base));
  });

  test("long Quranic verse with heavy diacritics", () => {
    // Ayat al-Kursi (2:255) first portion
    const ayah = "ٱللَّهُ لَآ إِلَٰهَ إِلَّا هُوَ ٱلۡحَيُّ ٱلۡقَيُّومُ";
    const width = getVisualWidth(ayah);
    // Width should be strictly less than character count
    expect(width).toBeLessThan([...ayah].length);
    // Width should be greater than 0
    expect(width).toBeGreaterThan(0);
    // Width should roughly equal the number of non-combining chars
    let nonCombining = 0;
    for (const ch of ayah) {
      if (!isZeroWidth(ch.codePointAt(0)!)) nonCombining++;
    }
    expect(width).toBe(nonCombining);
  });
});
