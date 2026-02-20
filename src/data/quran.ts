/**
 * Data access layer for Quran text data.
 *
 * Provides typed access to surah and verse data from the quran-json package.
 * All verse numbering is 1-based to match Islamic scholarly convention.
 * Supports multiple languages and transliteration.
 */
import { createRequire } from "node:module";

// ---------------------------------------------------------------------------
// Raw JSON types (matching quran-json chapter file structure)
// ---------------------------------------------------------------------------

/** Verse as stored in per-chapter JSON files */
interface RawVerse {
  id: number;
  text: string;
  translation: string;
  transliteration: string;
}

/** Chapter as stored in per-chapter JSON files */
interface RawChapter {
  id: number;
  name: string;
  transliteration: string;
  translation: string;
  type: string;
  total_verses: number;
  verses: RawVerse[];
}

/** Chapter index entry (from chapters/index.json, no verses) */
interface RawChapterIndex {
  id: number;
  name: string;
  transliteration: string;
  type: string;
  total_verses: number;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Total number of surahs in the Quran */
export const TOTAL_SURAHS = 114;

/** Supported translation languages */
export const LANGUAGES = [
  "bn",
  "en",
  "es",
  "fr",
  "id",
  "ru",
  "sv",
  "tr",
  "ur",
  "zh",
] as const;

/** A single verse (ayah) */
export interface Verse {
  /** 1-based verse number within the surah */
  id: number;
  /** Arabic text */
  text: string;
  /** Translation in the requested language */
  translation: string;
  /** Romanized transliteration */
  transliteration?: string;
}

/** A surah (chapter) with its verses */
export interface Surah {
  /** 1-based surah number (1–114) */
  id: number;
  /** Arabic name */
  name: string;
  /** Transliterated name (e.g. "Al-Fatihah") */
  transliteration: string;
  /** English meaning of the name (e.g. "The Opener") */
  translation: string;
  /** Revelation type */
  type: "meccan" | "medinan";
  /** Total verse count */
  totalVerses: number;
  /** All verses in the surah */
  verses: Verse[];
}

/** A verse with its surah context, returned by getVerse() and search() */
export interface VerseRef {
  surahId: number;
  surahName: string;
  surahTransliteration: string;
  verseId: number;
  text: string;
  translation: string;
  /** Romanized transliteration */
  transliteration?: string;
  /** Colon-notation reference, e.g. "2:255" */
  reference: string;
}

// ---------------------------------------------------------------------------
// Data loading (lazy, cached)
// ---------------------------------------------------------------------------

const _require = createRequire(import.meta.url);

/**
 * Per-chapter cache keyed by "${language}:${chapterId}".
 * Avoids re-reading individual chapter JSON files.
 */
const _chapterCache = new Map<string, RawChapter>();

/**
 * Chapter index: lightweight metadata for name-to-id resolution.
 * Loaded lazily from chapters/index.json (no verse data).
 */
let _chapterIndex: RawChapterIndex[] | null = null;
let _indexByName: Map<string, number> | null = null;

function loadChapterIndex(): void {
  if (_chapterIndex !== null) return;
  _chapterIndex = _require(
    "quran-json/dist/chapters/index.json",
  ) as RawChapterIndex[];
  _indexByName = new Map<string, number>();
  for (const entry of _chapterIndex) {
    _indexByName.set(entry.transliteration.toLowerCase(), entry.id);
  }
}

/**
 * Load a specific chapter for a given language.
 * Uses the per-chapter files at quran-json/dist/chapters/{lang}/{id}.json.
 */
function loadChapter(language: string, id: number): RawChapter | null {
  const cacheKey = `${language}:${id}`;
  const cached = _chapterCache.get(cacheKey);
  if (cached) return cached;

  try {
    const chapter = _require(
      `quran-json/dist/chapters/${language}/${id}.json`,
    ) as RawChapter;
    _chapterCache.set(cacheKey, chapter);
    return chapter;
  } catch {
    return null;
  }
}

/**
 * Resolve a transliterated name to a numeric chapter ID.
 * Uses the lightweight index (no full monolithic load needed).
 */
function resolveNameToId(name: string): number | null {
  loadChapterIndex();
  return _indexByName!.get(name.trim().toLowerCase()) ?? null;
}

// ---------------------------------------------------------------------------
// Arabic text normalization
// ---------------------------------------------------------------------------

/**
 * Strip Arabic diacritics (harakat) and normalize alef variants so that
 * a plain query like "الله" matches diacriticized text like "ٱللَّهِ".
 */
function normalizeArabic(text: string): string {
  return text
    // Remove diacritics: tatweel, harakat, superscript alef, etc.
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g, "")
    // Normalize alef variants (أ إ آ ٱ ٲ ٳ) → bare alef ا
    .replace(/[\u0622\u0623\u0625\u0671\u0672\u0673]/g, "\u0627");
}

// ---------------------------------------------------------------------------
// Monolithic English data (kept ONLY for search)
// ---------------------------------------------------------------------------

let _searchChapters: RawChapter[] | null = null;

function loadSearchData(): RawChapter[] {
  if (_searchChapters === null) {
    _searchChapters = _require(
      "quran-json/dist/quran_en.json",
    ) as RawChapter[];
  }
  return _searchChapters;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rawToSurah(raw: RawChapter): Surah {
  return {
    id: raw.id,
    name: raw.name,
    transliteration: raw.transliteration,
    translation: raw.translation,
    type: raw.type as "meccan" | "medinan",
    totalVerses: raw.total_verses,
    verses: raw.verses.map((v) => ({
      id: v.id,
      text: v.text,
      translation: v.translation,
      transliteration: v.transliteration || undefined,
    })),
  };
}

function rawToVerseRef(ch: RawChapter, v: RawVerse): VerseRef {
  return {
    surahId: ch.id,
    surahName: ch.name,
    surahTransliteration: ch.transliteration,
    verseId: v.id,
    text: v.text,
    translation: v.translation,
    transliteration: v.transliteration || undefined,
    reference: `${ch.id}:${v.id}`,
  };
}

/**
 * Parse a verse reference string like "1:1" or "2:255".
 * Returns null if the format is invalid.
 */
function parseVerseRef(ref: string): { surahId: number; verseId: number } | null {
  const parts = ref.split(":");
  const surahStr = parts[0];
  const verseStr = parts[1];

  if (parts.length !== 2 || surahStr === undefined || verseStr === undefined) {
    return null;
  }

  const surahId = Number(surahStr);
  const verseId = Number(verseStr);

  if (!Number.isInteger(surahId) || !Number.isInteger(verseId)) return null;
  if (surahId < 1 || surahId > TOTAL_SURAHS) return null;
  if (verseId < 1) return null;

  return { surahId, verseId };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a surah by its numeric ID (1–114) or transliterated name.
 *
 * Name matching is case-insensitive and trims whitespace.
 *
 * @param id - Surah number (1–114) or transliterated name.
 * @param language - ISO language code (default: "en"). One of LANGUAGES.
 *
 * @example
 * ```ts
 * getSurah(1)              // Al-Fatihah (English)
 * getSurah(1, "fr")        // Al-Fatihah (French)
 * getSurah("al-baqarah")   // Al-Baqarah (English)
 * ```
 *
 * @returns The surah with all verses, or `null` if not found.
 */
export function getSurah(
  id: number | string,
  language: string = "en",
): Surah | null {
  if (typeof id === "number") {
    if (!Number.isInteger(id) || id < 1 || id > TOTAL_SURAHS) return null;
    const raw = loadChapter(language, id);
    return raw ? rawToSurah(raw) : null;
  }

  // String: case-insensitive transliteration match via index
  const normalized = id.trim().toLowerCase();
  if (normalized.length === 0) return null;

  const numericId = resolveNameToId(normalized);
  if (numericId === null) return null;

  const raw = loadChapter(language, numericId);
  return raw ? rawToSurah(raw) : null;
}

/**
 * Get a single verse by its colon-notation reference.
 *
 * @param ref - Reference in "surah:verse" format, e.g. "1:1", "2:255"
 * @param language - ISO language code (default: "en"). One of LANGUAGES.
 * @returns The verse with surah context, or `null` if not found.
 */
export function getVerse(
  ref: string,
  language: string = "en",
): VerseRef | null {
  const parsed = parseVerseRef(ref);
  if (!parsed) return null;

  const chapter = loadChapter(language, parsed.surahId);
  if (!chapter) return null;

  // Verse IDs are 1-based in data; use find() to avoid off-by-one issues
  const verse = chapter.verses.find((v) => v.id === parsed.verseId);
  if (!verse) return null;

  return rawToVerseRef(chapter, verse);
}

/**
 * Search verse translations for a query string.
 *
 * Currently searches English translations only (monolithic quran_en.json).
 *
 * @param query - Case-insensitive search term.
 * @returns Array of matching verses with references. Empty array if no matches
 *          or if query is empty/whitespace.
 */
export function search(query: string): VerseRef[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return [];

  const results: VerseRef[] = [];
  const chapters = loadSearchData();

  for (const ch of chapters) {
    for (const v of ch.verses) {
      if (v.translation.toLowerCase().includes(trimmed) || normalizeArabic(v.text).includes(normalizeArabic(query.trim()))) {
        results.push(rawToVerseRef(ch, v));
      }
    }
  }

  return results;
}
