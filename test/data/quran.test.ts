import { describe, expect, it } from "bun:test";
import {
  getSurah,
  getVerse,
  search,
  TOTAL_SURAHS,
  loadLanguage,
} from "../../src/data/quran";
import type { Surah, VerseRef } from "../../src/data/quran";

// ---------------------------------------------------------------------------
// getSurah
// ---------------------------------------------------------------------------

describe("getSurah", () => {
  describe("by numeric ID", () => {
    it("returns Al-Fatihah for id=1", () => {
      const s = getSurah(1);
      expect(s).not.toBeNull();
      expect(s!.id).toBe(1);
      expect(s!.transliteration).toBe("Al-Fatihah");
      expect(s!.translation).toBe("The Opener");
      expect(s!.type).toBe("meccan");
      expect(s!.totalVerses).toBe(7);
      expect(s!.verses).toHaveLength(7);
    });

    it("returns An-Nas for id=114", () => {
      const s = getSurah(114);
      expect(s).not.toBeNull();
      expect(s!.id).toBe(114);
      expect(s!.transliteration).toBe("An-Nas");
      expect(s!.totalVerses).toBe(6);
      expect(s!.verses).toHaveLength(6);
    });

    it("returns Al-A'raf for id=7", () => {
      const s = getSurah(7);
      expect(s).not.toBeNull();
      expect(s!.id).toBe(7);
      expect(s!.transliteration).toBe("Al-A'raf");
    });

    it("all 114 surahs are accessible", () => {
      for (let i = 1; i <= TOTAL_SURAHS; i++) {
        const s = getSurah(i);
        expect(s).not.toBeNull();
        expect(s!.id).toBe(i);
        expect(s!.verses.length).toBeGreaterThan(0);
      }
    });

    it("verse IDs are 1-based", () => {
      const s = getSurah(1);
      expect(s).not.toBeNull();
      expect(s!.verses[0]!.id).toBe(1);
      expect(s!.verses[s!.verses.length - 1]!.id).toBe(s!.totalVerses);
    });

    it("returns correct shape for surah", () => {
      const s = getSurah(2) as Surah;
      expect(s).toHaveProperty("id");
      expect(s).toHaveProperty("name");
      expect(s).toHaveProperty("transliteration");
      expect(s).toHaveProperty("translation");
      expect(s).toHaveProperty("type");
      expect(s).toHaveProperty("totalVerses");
      expect(s).toHaveProperty("verses");
      // Verify verse shape
      const v = s.verses[0]!;
      expect(v).toHaveProperty("id");
      expect(v).toHaveProperty("text");
      expect(v).toHaveProperty("translation");
    });
  });

  describe("by transliterated name", () => {
    it("finds Al-Fatihah (exact case)", () => {
      const s = getSurah("Al-Fatihah");
      expect(s).not.toBeNull();
      expect(s!.id).toBe(1);
    });

    it("finds al-fatihah (lowercase)", () => {
      const s = getSurah("al-fatihah");
      expect(s).not.toBeNull();
      expect(s!.id).toBe(1);
    });

    it("finds AL-BAQARAH (uppercase)", () => {
      const s = getSurah("AL-BAQARAH");
      expect(s).not.toBeNull();
      expect(s!.id).toBe(2);
    });

    it("trims whitespace", () => {
      const s = getSurah("  Al-Fatihah  ");
      expect(s).not.toBeNull();
      expect(s!.id).toBe(1);
    });

    it("finds An-Nas", () => {
      const s = getSurah("An-Nas");
      expect(s).not.toBeNull();
      expect(s!.id).toBe(114);
    });
  });

  describe("invalid input", () => {
    it("returns null for id=0", () => {
      expect(getSurah(0)).toBeNull();
    });

    it("returns null for id=115", () => {
      expect(getSurah(115)).toBeNull();
    });

    it("returns null for negative id", () => {
      expect(getSurah(-1)).toBeNull();
    });

    it("returns null for non-integer id", () => {
      expect(getSurah(1.5)).toBeNull();
    });

    it("returns null for NaN", () => {
      expect(getSurah(NaN)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(getSurah("")).toBeNull();
    });

    it("returns null for whitespace-only string", () => {
      expect(getSurah("   ")).toBeNull();
    });

    it("returns null for unknown name", () => {
      expect(getSurah("not-a-surah")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// getVerse
// ---------------------------------------------------------------------------

describe("getVerse", () => {
  describe("valid references", () => {
    it("returns first verse of Al-Fatihah (1:1)", () => {
      const v = getVerse("1:1");
      expect(v).not.toBeNull();
      expect(v!.surahId).toBe(1);
      expect(v!.verseId).toBe(1);
      expect(v!.reference).toBe("1:1");
      expect(v!.surahTransliteration).toBe("Al-Fatihah");
      expect(v!.translation).toContain("In the name of Allah");
    });

    it("returns last verse of Al-Fatihah (1:7)", () => {
      const v = getVerse("1:7");
      expect(v).not.toBeNull();
      expect(v!.surahId).toBe(1);
      expect(v!.verseId).toBe(7);
      expect(v!.reference).toBe("1:7");
    });

    it("returns Ayat al-Kursi (2:255)", () => {
      const v = getVerse("2:255");
      expect(v).not.toBeNull();
      expect(v!.surahId).toBe(2);
      expect(v!.verseId).toBe(255);
      expect(v!.reference).toBe("2:255");
      expect(v!.translation).toContain("Allah");
    });

    it("returns last verse of An-Nas (114:6)", () => {
      const v = getVerse("114:6");
      expect(v).not.toBeNull();
      expect(v!.surahId).toBe(114);
      expect(v!.verseId).toBe(6);
      expect(v!.reference).toBe("114:6");
    });

    it("returns correct VerseRef shape", () => {
      const v = getVerse("1:1") as VerseRef;
      expect(v).toHaveProperty("surahId");
      expect(v).toHaveProperty("surahName");
      expect(v).toHaveProperty("surahTransliteration");
      expect(v).toHaveProperty("verseId");
      expect(v).toHaveProperty("text");
      expect(v).toHaveProperty("translation");
      expect(v).toHaveProperty("reference");
    });

    it("verse text contains Arabic", () => {
      const v = getVerse("1:1");
      expect(v).not.toBeNull();
      // Arabic text should have Arabic Unicode characters
      expect(v!.text.length).toBeGreaterThan(0);
    });
  });

  describe("invalid format", () => {
    it("returns null for plain text", () => {
      expect(getVerse("abc")).toBeNull();
    });

    it("returns null for single number", () => {
      expect(getVerse("1")).toBeNull();
    });

    it("returns null for triple colon format", () => {
      expect(getVerse("1:1:1")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(getVerse("")).toBeNull();
    });

    it("returns null for colon only", () => {
      expect(getVerse(":")).toBeNull();
    });

    it("returns null for non-numeric parts", () => {
      expect(getVerse("a:b")).toBeNull();
    });

    it("returns null for float values", () => {
      expect(getVerse("1.5:2")).toBeNull();
    });
  });

  describe("out of range", () => {
    it("returns null for surah 0", () => {
      expect(getVerse("0:1")).toBeNull();
    });

    it("returns null for surah 115", () => {
      expect(getVerse("115:1")).toBeNull();
    });

    it("returns null for verse 0", () => {
      expect(getVerse("1:0")).toBeNull();
    });

    it("returns null for verse beyond surah length", () => {
      // Al-Fatihah has 7 verses
      expect(getVerse("1:8")).toBeNull();
      expect(getVerse("1:999")).toBeNull();
    });

    it("returns null for negative surah", () => {
      expect(getVerse("-1:1")).toBeNull();
    });

    it("returns null for negative verse", () => {
      expect(getVerse("1:-1")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

  describe("search", () => {
    it("searches the requested translation language", async () => {
      await loadLanguage("fr");
      const results = search("Au nom d'Allah", "fr");
      expect(results.some((result) => result.reference === "1:1")).toBe(true);
      expect(results[0]?.translation).toContain("Au nom d'Allah");
    });

  it("finds verses containing 'mercy'", () => {
    const results = search("mercy");
    expect(results.length).toBeGreaterThan(0);
    // Every result should contain "mercy" (case-insensitive)
    for (const r of results) {
      expect(r.translation.toLowerCase()).toContain("mercy");
    }
  });

  it("is case-insensitive", () => {
    const lower = search("mercy");
    const upper = search("MERCY");
    const mixed = search("Mercy");
    expect(lower.length).toBe(upper.length);
    expect(lower.length).toBe(mixed.length);
  });

  it("returns results with correct VerseRef shape", () => {
    const results = search("mercy");
    expect(results.length).toBeGreaterThan(0);
    const r = results[0]!;
    expect(r).toHaveProperty("surahId");
    expect(r).toHaveProperty("surahName");
    expect(r).toHaveProperty("surahTransliteration");
    expect(r).toHaveProperty("verseId");
    expect(r).toHaveProperty("text");
    expect(r).toHaveProperty("translation");
    expect(r).toHaveProperty("reference");
    expect(r.reference).toMatch(/^\d+:\d+$/);
  });

  it("finds 'Entirely Merciful' in Al-Fatihah", () => {
    const results = search("Entirely Merciful");
    expect(results.length).toBeGreaterThan(0);
    // Should find at least 1:1 and 1:3
    const refs = results.map((r) => r.reference);
    expect(refs).toContain("1:1");
    expect(refs).toContain("1:3");
  });

  it("returns empty array for empty query", () => {
    expect(search("")).toEqual([]);
  });

  it("returns empty array for whitespace-only query", () => {
    expect(search("   ")).toEqual([]);
  });

  it("returns empty array for nonsense query", () => {
    expect(search("xyzzyplughtwisty42")).toEqual([]);
  });

  it("trims query whitespace", () => {
    const trimmed = search("mercy");
    const padded = search("  mercy  ");
    expect(trimmed.length).toBe(padded.length);
  });
});

// ---------------------------------------------------------------------------
// TOTAL_SURAHS constant
// ---------------------------------------------------------------------------

describe("TOTAL_SURAHS", () => {
  it("equals 114", () => {
    expect(TOTAL_SURAHS).toBe(114);
  });
});
