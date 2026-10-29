import { describe, expect, test } from "bun:test";
import quranEn from "quran-json/dist/quran_en.json";
import { findSurahId, normalizeSurahName, suggestSurahs } from "../../src/data/quran.ts";
import { parseQuranReference } from "../../src/data/reference.ts";

describe("forgiving surah names", () => {
  test("every surah keeps a unique loose name", () => {
    const keys = (quranEn as { transliteration: string }[]).map((surah) => normalizeSurahName(surah.transliteration));
    expect(new Set(keys).size).toBe(114);
  });

  test("common spellings resolve", () => {
    expect(findSurahId("fatiha")).toBe(1);
    expect(findSurahId("Al-Fatiha")).toBe(1);
    expect(findSurahId("the cow")).toBe(2);
    expect(findSurahId("baqara")).toBe(2);
    expect(findSurahId("Ya Sin")).toBe(36);
    expect(findSurahId("yasin")).toBe(36);
    expect(findSurahId("muzammil")).toBe(73);
    expect(findSurahId("الفاتحة")).toBe(1);
    expect(findSurahId("not-a-surah")).toBeNull();
  });

  test("near misses get suggestions, nonsense does not", () => {
    expect(suggestSurahs("fatiah")[0]?.id).toBe(1);
    expect(suggestSurahs("imran")[0]?.id).toBe(3);
    expect(suggestSurahs("zz")).toEqual([]);
  });
});

describe("parseQuranReference", () => {
  test("accepts numbers, verse references and names", () => {
    expect(parseQuranReference("2")).toMatchObject({ ok: true, surahId: 2 });
    expect(parseQuranReference("2:255")).toMatchObject({ ok: true, surahId: 2, verseId: 255 });
    expect(parseQuranReference("2 255")).toMatchObject({ ok: true, surahId: 2, verseId: 255 });
    expect(parseQuranReference("kahf 10")).toMatchObject({ ok: true, surahId: 18, verseId: 10 });
    expect(parseQuranReference("kahf:10")).toMatchObject({ ok: true, surahId: 18, verseId: 10 });
    expect(parseQuranReference("surah yasin")).toMatchObject({ ok: true, surahId: 36 });
  });

  test("explains what is wrong", () => {
    const overflow = parseQuranReference("2:300");
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.message).toContain("has 286 verses");

    const range = parseQuranReference("115");
    if (!range.ok) expect(range.message).toContain("1-114");
    expect(range.ok).toBe(false);

    const unknown = parseQuranReference("fatiah");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.message).toContain("Did you mean Al-Fatihah (1)");

    expect(parseQuranReference("").ok).toBe(false);
  });
});
