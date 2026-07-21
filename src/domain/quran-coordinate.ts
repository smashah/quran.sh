export type VerseKey = `${number}:${number}`;
export type WordKey = `${number}:${number}:${number}`;

export interface VerseCoordinate {
  readonly surah: number;
  readonly ayah: number;
  readonly key: VerseKey;
}

export interface WordCoordinate {
  readonly surah: number;
  readonly ayah: number;
  readonly word: number;
  readonly key: WordKey;
}

const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value > 0;

/** Canonical Hafs ayah counts, indexed by surah - 1 (total: 6,236). */
export const QURAN_VERSE_COUNTS: readonly number[] = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98,
  135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85,
  54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14,
  11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19,
  36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5,
  4, 7, 3, 6, 3, 5, 4, 5, 6,
];

export function makeVerseKey(surah: number, ayah: number): VerseKey {
  if (!isPositiveInteger(surah) || surah > QURAN_VERSE_COUNTS.length || !isPositiveInteger(ayah) || ayah > (QURAN_VERSE_COUNTS[surah - 1] ?? 0)) {
    throw new RangeError(`Invalid Quran verse coordinate: ${surah}:${ayah}`);
  }
  return `${surah}:${ayah}`;
}

export function makeWordKey(surah: number, ayah: number, word: number): WordKey {
  if (!isPositiveInteger(word)) {
    throw new RangeError(`Invalid Quran word coordinate: ${surah}:${ayah}:${word}`);
  }
  return `${makeVerseKey(surah, ayah)}:${word}`;
}

export function parseVerseKey(value: string): VerseCoordinate | null {
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  const surah = Number(match[1]);
  const ayah = Number(match[2]);
  try {
    return { surah, ayah, key: makeVerseKey(surah, ayah) };
  } catch {
    return null;
  }
}

export function parseWordKey(value: string): WordCoordinate | null {
  const match = /^(\d+):(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  const surah = Number(match[1]);
  const ayah = Number(match[2]);
  const word = Number(match[3]);
  try {
    return { surah, ayah, word, key: makeWordKey(surah, ayah, word) };
  } catch {
    return null;
  }
}

/**
 * Conservative normalization used only to compare upstream token boundaries.
 * It never mutates displayed Quran text.
 */
export function normalizeArabicForAlignment(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[\u0622\u0623\u0625\u0671\u0672\u0673]/g, "\u0627")
    .replace(/[\s\u06DD\u06DE\u06E9]+/g, "");
}

export interface WordMapping {
  readonly source: readonly number[];
  readonly target: readonly number[];
}

export type SourceWordMapping =
  | { readonly status: "mapped"; readonly sourceIndexes: readonly number[]; readonly wordKeys: readonly WordKey[] }
  | { readonly status: "omitted"; readonly sourceIndexes: readonly number[]; readonly reason: string }
  | { readonly status: "synthetic"; readonly wordKeys: readonly WordKey[]; readonly reason: string }
  | { readonly status: "ambiguous"; readonly sourceIndexes: readonly number[]; readonly candidates: readonly WordKey[] };

export interface CoordinateCoverage {
  readonly ok: boolean;
  readonly verseCount: number;
  readonly wordCount: number;
  readonly missingVerses: readonly VerseKey[];
  readonly duplicateWords: readonly WordKey[];
  readonly invalidWords: readonly string[];
}

export function auditCoordinateCoverage(
  wordKeys: readonly string[],
  expectedVerses: readonly VerseKey[],
): CoordinateCoverage {
  const verses = new Set<VerseKey>();
  const words = new Set<WordKey>();
  const duplicates = new Set<WordKey>();
  const invalidWords: string[] = [];
  for (const value of wordKeys) {
    const coordinate = parseWordKey(value);
    if (!coordinate) { invalidWords.push(value); continue; }
    if (words.has(coordinate.key)) duplicates.add(coordinate.key);
    words.add(coordinate.key);
    verses.add(makeVerseKey(coordinate.surah, coordinate.ayah));
  }
  const missingVerses = expectedVerses.filter((verse) => !verses.has(verse));
  return {
    ok: missingVerses.length === 0 && duplicates.size === 0 && invalidWords.length === 0 && verses.size === expectedVerses.length,
    verseCount: verses.size,
    wordCount: words.size,
    missingVerses,
    duplicateWords: [...duplicates],
    invalidWords,
  };
}

export type WordAlignment =
  | { readonly status: "aligned"; readonly mappings: readonly WordMapping[] }
  | { readonly status: "ambiguous"; readonly sourceIndex: number; readonly targetIndex: number };

function indexes(start: number, length: number): number[] {
  return Array.from({ length }, (_, index) => start + index);
}

/**
 * Align two per-ayah tokenizations without assuming their indexes coincide.
 * Joins of up to three adjacent tokens are accepted; anything else is exposed
 * as ambiguous so callers can fall back to ayah-level progress.
 */
export function alignWordSequences(
  sourceWords: readonly string[],
  targetWords: readonly string[],
): WordAlignment {
  const source = sourceWords.map(normalizeArabicForAlignment);
  const target = targetWords.map(normalizeArabicForAlignment);
  const mappings: WordMapping[] = [];
  let sourceIndex = 0;
  let targetIndex = 0;

  while (sourceIndex < source.length && targetIndex < target.length) {
    if (source[sourceIndex] === target[targetIndex]) {
      mappings.push({ source: [sourceIndex], target: [targetIndex] });
      sourceIndex += 1;
      targetIndex += 1;
      continue;
    }

    let matched = false;
    for (let count = 2; count <= 3 && sourceIndex + count <= source.length; count += 1) {
      if (source.slice(sourceIndex, sourceIndex + count).join("") === target[targetIndex]) {
        mappings.push({ source: indexes(sourceIndex, count), target: [targetIndex] });
        sourceIndex += count;
        targetIndex += 1;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    for (let count = 2; count <= 3 && targetIndex + count <= target.length; count += 1) {
      if (target.slice(targetIndex, targetIndex + count).join("") === source[sourceIndex]) {
        mappings.push({ source: [sourceIndex], target: indexes(targetIndex, count) });
        sourceIndex += 1;
        targetIndex += count;
        matched = true;
        break;
      }
    }
    if (!matched) return { status: "ambiguous", sourceIndex, targetIndex };
  }

  if (sourceIndex !== source.length || targetIndex !== target.length) {
    return { status: "ambiguous", sourceIndex, targetIndex };
  }
  return { status: "aligned", mappings };
}
