import { getSurah, getVerse, LANGUAGES, loadLanguage, search } from "../data/quran.ts";
import type { Surah, VerseRef } from "../data/quran.ts";
import { parseQuranReference } from "../data/reference.ts";
import { openDatabase } from "../data/db.ts";
import { logSurah, logVerse } from "../data/log.ts";
import { getReadingStats } from "../data/streaks.ts";

export interface CommandOptions {
  readonly language: string;
  readonly arabic: boolean;
  readonly numbers: boolean;
}

export type ParsedCommand =
  | { readonly ok: true; readonly positional: string[]; readonly options: CommandOptions }
  | { readonly ok: false; readonly message: string };

type OptionCommand = "read" | "search" | "log" | "streak";

const OPTIONS_BY_COMMAND: Record<OptionCommand, readonly string[]> = {
  read: ["lang", "arabic", "numbers"],
  search: ["lang"],
  log: [],
  streak: [],
};

/** Parse the small option set; unknown flags are errors instead of being silently ignored. */
export function parseCommandOptions(command: OptionCommand, args: readonly string[]): ParsedCommand {
  const allowed = OPTIONS_BY_COMMAND[command];
  const positional: string[] = [];
  let language = "en";
  let arabic = false;
  let numbers = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith("-") || /^-\d/u.test(arg)) {
      positional.push(arg);
      continue;
    }
    const [flag, inlineValue] = arg.split("=", 2) as [string, string | undefined];
    const name = flag === "-l" || flag === "--lang" ? "lang"
      : flag === "-a" || flag === "--arabic" ? "arabic"
        : flag === "-n" || flag === "--numbers" ? "numbers"
          : null;
    if (!name || !allowed.includes(name)) {
      const supported = allowed.length > 0
        ? ` Supported: ${allowed.map((option) => `--${option}`).join(", ")}.`
        : ` "quran ${command}" takes no options.`;
      return { ok: false, message: `Unknown option "${flag}" for quran ${command}.${supported}` };
    }
    if (name === "lang") {
      const value = inlineValue ?? args[index + 1];
      if (inlineValue === undefined) index += 1;
      if (!value || !LANGUAGES.includes(value as (typeof LANGUAGES)[number])) {
        return { ok: false, message: `--lang needs one of: ${LANGUAGES.join(" ")}.` };
      }
      language = value;
    } else if (name === "arabic") arabic = true;
    else numbers = true;
  }
  if (command === "streak" && positional.length > 0) {
    return { ok: false, message: `"quran streak" takes no arguments.` };
  }
  return { ok: true, positional, options: { language, arabic, numbers } };
}

const DEFAULT_OPTIONS: CommandOptions = { language: "en", arabic: false, numbers: false };

function formatSurah(surah: Surah, options: CommandOptions): string {
  const header = `Surah ${surah.id}: ${surah.transliteration} (${surah.translation})`;
  if (!options.arabic) {
    const verses = surah.verses.map((verse) => options.numbers
      ? `[${surah.id}:${verse.id}] ${verse.translation}`
      : verse.translation);
    return `${header}\n\n${verses.join("\n")}`;
  }
  const verses = surah.verses.map((verse) => {
    const reference = options.numbers ? `[${surah.id}:${verse.id}]\n` : "";
    return `${reference}${verse.text}\n${verse.translation}`;
  });
  return `${header}\n\n${verses.join("\n\n")}`;
}

function formatVerse(verse: VerseRef, options: CommandOptions): string {
  return options.arabic
    ? `[${verse.reference}]\n${verse.text}\n${verse.translation}`
    : `[${verse.reference}] ${verse.translation}`;
}

function read(ref: string, options: CommandOptions): { ok: boolean; output: string } {
  const parsed = parseQuranReference(ref);
  if (!parsed.ok) return { ok: false, output: `Error: ${parsed.message}` };
  if (parsed.verseId !== undefined) {
    const verse = getVerse(`${parsed.surahId}:${parsed.verseId}`, options.language);
    return verse
      ? { ok: true, output: formatVerse(verse, options) }
      : { ok: false, output: `Error: Verse ${parsed.surahId}:${parsed.verseId} is unavailable.` };
  }
  const surah = getSurah(parsed.surahId, options.language);
  return surah
    ? { ok: true, output: formatSurah(surah, options) }
    : { ok: false, output: `Error: Surah ${parsed.surahId} is unavailable.` };
}

function log(ref: string): { ok: boolean; output: string } {
  const parsed = parseQuranReference(ref);
  if (!parsed.ok) return { ok: false, output: `Error: ${parsed.message}` };
  openDatabase();
  if (parsed.verseId !== undefined) {
    const result = logVerse(`${parsed.surahId}:${parsed.verseId}`);
    return { ok: result.ok, output: result.message };
  }
  const result = logSurah(getSurah(parsed.surahId)!);
  return { ok: result.ok, output: result.message };
}

export async function runReferenceCommand(
  command: "read" | "log",
  ref: string,
  options: CommandOptions = DEFAULT_OPTIONS,
): Promise<number> {
  if (command === "read" && options.language !== "en") await loadLanguage(options.language);
  const result = command === "read" ? read(ref, options) : log(ref);
  const write = result.ok ? console.log : console.error;
  write(result.output);
  return result.ok ? 0 : 1;
}

export async function runSearch(query: string, options: CommandOptions = DEFAULT_OPTIONS): Promise<number> {
  if (query.trim().length === 0) {
    console.error("Error: Missing search query. Usage: quran search <query>");
    return 1;
  }

  if (options.language !== "en") await loadLanguage(options.language);
  const results = search(query, options.language);
  if (results.length === 0) {
    console.error(`No results found for "${query}".`);
    return 1;
  }

  const lines = results.map((result) => `[${result.reference}] ${result.translation}`);
  console.log(`Found ${results.length} result(s) for "${query}":\n\n${lines.join("\n")}`);
  return 0;
}

function days(count: number): string {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

export function runStreak(): number {
  openDatabase();
  const stats = getReadingStats();
  console.log("Reading Streak");
  console.log("------------------");
  console.log(`Current Streak: ${days(stats.currentStreak)}`);
  console.log(`Longest Streak: ${days(stats.longestStreak)}`);
  console.log(`Total Reading Days: ${days(stats.totalDays)}`);
  return 0;
}
