import { getSurah, getVerse, search, TOTAL_SURAHS } from "../data/quran.ts";
import type { Surah, VerseRef } from "../data/quran.ts";
import { openDatabase } from "../data/db.ts";
import { logSurah, logVerse } from "../data/log.ts";
import { getReadingStats } from "../data/streaks.ts";

function formatSurah(surah: Surah): string {
  const header = `Surah ${surah.id}: ${surah.transliteration} (${surah.translation})`;
  const verses = surah.verses.map((verse) => verse.translation).join("\n");
  return `${header}\n\n${verses}`;
}

function formatVerse(verse: VerseRef): string {
  return `[${verse.reference}] ${verse.translation}`;
}

function read(ref: string): { ok: boolean; output: string } {
  if (ref.includes(":")) {
    const verse = getVerse(ref);
    return verse
      ? { ok: true, output: formatVerse(verse) }
      : {
          ok: false,
          output: `Error: Verse "${ref}" not found. Use format "surah:verse" (e.g. 1:1, 2:255).`,
        };
  }

  const surah = /^\d+$/.test(ref) ? getSurah(Number(ref)) : getSurah(ref);
  if (!surah) {
    return /^\d+$/.test(ref)
      ? {
          ok: false,
          output: `Error: Surah ${ref} not found. Valid range: 1-${TOTAL_SURAHS}.`,
        }
      : {
          ok: false,
          output: `Error: Surah "${ref}" not found. Use transliterated name (e.g. al-fatihah, al-baqarah).`,
        };
  }
  return { ok: true, output: formatSurah(surah) };
}

function log(ref: string): { ok: boolean; output: string } {
  openDatabase();
  if (ref.includes(":")) {
    const result = logVerse(ref);
    return { ok: result.ok, output: result.message };
  }

  const surah = /^\d+$/.test(ref) ? getSurah(Number(ref)) : getSurah(ref);
  if (!surah) {
    return /^\d+$/.test(ref)
      ? {
          ok: false,
          output: `Error: Surah ${ref} not found. Valid range: 1-${TOTAL_SURAHS}.`,
        }
      : {
          ok: false,
          output: `Error: Surah "${ref}" not found. Use transliterated name (e.g. al-fatihah, al-baqarah).`,
        };
  }
  const result = logSurah(surah);
  return { ok: result.ok, output: result.message };
}

export function runReferenceCommand(command: "read" | "log", ref: string): number {
  const result = command === "read" ? read(ref) : log(ref);
  const write = result.ok ? console.log : console.error;
  write(result.output);
  return result.ok ? 0 : 1;
}

export function runSearch(query: string): number {
  if (query.trim().length === 0) {
    console.error("Error: Missing search query. Usage: quran.sh search <query>");
    return 1;
  }

  const results = search(query);
  if (results.length === 0) {
    console.error(`No results found for "${query}".`);
    return 1;
  }

  const lines = results.map((result) => `[${result.reference}] ${result.translation}`);
  console.log(`Found ${results.length} result(s) for "${query}":\n\n${lines.join("\n")}`);
  return 0;
}

export function runStreak(): number {
  openDatabase();
  const stats = getReadingStats();
  console.log("Reading Streak");
  console.log("------------------");
  console.log(`Current Streak: ${stats.currentStreak} days`);
  console.log(`Longest Streak: ${stats.longestStreak} days`);
  console.log(`Total Reading Days: ${stats.totalDays} days`);
  return 0;
}
