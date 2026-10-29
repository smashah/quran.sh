/**
 * Parse the references people type: "2", "2:255", "2 255", "al-baqarah",
 * "baqarah 255", "kahf:10", or "the cow". Shared by the CLI and the
 * in-reader "Go to" dialog so both accept and explain the same input.
 */
import { findSurahId, getSurah, suggestSurahs, TOTAL_SURAHS } from "./quran.ts";

export type QuranReference =
  | { readonly ok: true; readonly surahId: number; readonly verseId?: number; readonly label: string }
  | { readonly ok: false; readonly message: string };

const REFERENCE_HELP = "Use a surah number (2), surah:verse (2:255), or a surah name (al-baqarah, baqarah 255).";

function surahLabel(surahId: number): string {
  const surah = getSurah(surahId);
  return surah ? `${surah.transliteration} (${surah.id})` : `Surah ${surahId}`;
}

export function parseQuranReference(input: string): QuranReference {
  const trimmed = input.trim().replace(/^surah?\s+/iu, "");
  if (trimmed.length === 0) return { ok: false, message: REFERENCE_HELP };

  // Split a trailing verse number off "2:255", "2 255", "baqarah:255" or "baqarah 255".
  const match = /^(.*?)(?:\s*[:.]\s*|\s+)(\d+)$/u.exec(trimmed);
  const surahPart = (match ? match[1]! : trimmed).trim();
  const versePart = match ? match[2] : undefined;
  if (surahPart.length === 0) return { ok: false, message: REFERENCE_HELP };

  let surahId: number | null;
  if (/^\d+$/u.test(surahPart)) {
    surahId = Number(surahPart);
    if (surahId < 1 || surahId > TOTAL_SURAHS) {
      return { ok: false, message: `Surah ${surahPart} doesn't exist. Surahs are numbered 1-${TOTAL_SURAHS}.` };
    }
  } else {
    surahId = findSurahId(surahPart);
    if (surahId === null) {
      const suggestions = suggestSurahs(surahPart);
      const hint = suggestions.length > 0
        ? ` Did you mean ${suggestions.map((entry) => `${entry.transliteration} (${entry.id})`).join(", ")}?`
        : ` ${REFERENCE_HELP}`;
      return { ok: false, message: `No surah called "${surahPart}".${hint}` };
    }
  }

  const surah = getSurah(surahId)!;
  if (versePart === undefined) {
    return { ok: true, surahId, label: `${surah.transliteration} (${surah.id})` };
  }
  const verseId = Number(versePart);
  if (verseId < 1 || verseId > surah.totalVerses) {
    return {
      ok: false,
      message: `${surahLabel(surahId)} has ${surah.totalVerses} verses, so ${surahId}:${versePart} doesn't exist.`,
    };
  }
  return { ok: true, surahId, verseId, label: `${surah.transliteration} ${surahId}:${verseId}` };
}
