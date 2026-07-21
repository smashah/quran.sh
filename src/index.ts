#!/usr/bin/env bun
/**
 * quran.sh — CLI entry point.
 */
import { getSurah, getVerse, search, TOTAL_SURAHS } from "./data/quran.ts";
import type { Surah, VerseRef } from "./data/quran.ts";
import { logVerse, logSurah } from "./data/log.ts";
import { getReadingStats } from "./data/streaks.ts";
import { createRoot, createElement } from "@opentui/react";
import { ConsolePosition, createCliRenderer } from "@opentui/core";

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatSurah(surah: Surah): string {
  const header = `Surah ${surah.id}: ${surah.transliteration} (${surah.translation})`;
  const verses = surah.verses
    .map((v) => v.translation)
    .join("\n");
  return `${header}\n\n${verses}`;
}

function formatVerse(verse: VerseRef): string {
  return `[${verse.reference}] ${verse.translation}`;
}

// ---------------------------------------------------------------------------
// Reference parsing & dispatch
// ---------------------------------------------------------------------------

function handleRead(ref: string): { ok: boolean; output: string } {
  if (ref.includes(":")) {
    const verse = getVerse(ref);
    if (!verse) {
      return {
        ok: false,
        output: `Error: Verse "${ref}" not found. Use format "surah:verse" (e.g. 1:1, 2:255).`,
      };
    }
    return { ok: true, output: formatVerse(verse) };
  }

  if (/^\d+$/.test(ref)) {
    const id = Number(ref);
    const surah = getSurah(id);
    if (!surah) {
      return {
        ok: false,
        output: `Error: Surah ${id} not found. Valid range: 1-${TOTAL_SURAHS}.`,
      };
    }
    return { ok: true, output: formatSurah(surah) };
  }

  const surah = getSurah(ref);
  if (!surah) {
    return {
      ok: false,
      output: `Error: Surah "${ref}" not found. Use transliterated name (e.g. al-fatihah, al-baqarah).`,
    };
  }
  return { ok: true, output: formatSurah(surah) };
}

function handleLog(ref: string): { ok: boolean; output: string } {
  if (ref.includes(":")) {
    const result = logVerse(ref);
    return { ok: result.ok, output: result.message };
  }

  if (/^\d+$/.test(ref)) {
    const id = Number(ref);
    const surah = getSurah(id);
    if (!surah) {
      return {
        ok: false,
        output: `Error: Surah ${id} not found. Valid range: 1-${TOTAL_SURAHS}.`,
      };
    }
    const result = logSurah(surah);
    return { ok: result.ok, output: result.message };
  }

  const surah = getSurah(ref);
  if (!surah) {
    return {
      ok: false,
      output: `Error: Surah "${ref}" not found. Use transliterated name (e.g. al-fatihah, al-baqarah).`,
    };
  }
  const result = logSurah(surah);
  return { ok: result.ok, output: result.message };
}

function handleStreak(): void {
  const stats = getReadingStats();
  console.log("📖 Reading Streak");
  console.log("──────────────────");
  console.log(`Current Streak: ${stats.currentStreak} days`);
  console.log(`Longest Streak: ${stats.longestStreak} days`);
  console.log(`Total Reading Days: ${stats.totalDays} days`);
}

function handleSearch(query: string): { ok: boolean; output: string } {
  if (!query || query.trim().length === 0) {
    return {
      ok: false,
      output: 'Error: Missing search query. Usage: quran.sh search <query>',
    };
  }

  const results = search(query);
  if (results.length === 0) {
    return {
      ok: false,
      output: `No results found for "${query}".`,
    };
  }

  const lines = results.map((r) => `[${r.reference}] ${r.translation}`);
  return {
    ok: true,
    output: `Found ${results.length} result(s) for "${query}":\n\n${lines.join("\n")}`,
  };
}

function showUsage(): void {
  console.log(`quran.sh — Read the Quran from your terminal

Usage:
  quran.sh [command] [options]

Commands:
  (none)           Launch interactive TUI reader
  read   <ref>    Read a surah or verse
  log    <ref>    Log a surah or verse as read
  search <query>  Search verse translations
  streak          Show reading stats and streaks

Reference formats:
  1              Full surah by number (1-${TOTAL_SURAHS})
  1:1            Single verse (surah:verse)
  al-fatihah     Full surah by name

Examples:
  quran                    Launch TUI
  quran read 1             Al-Fatihah (full surah)
  quran read 1:1           First verse of Al-Fatihah
  quran search merciful    Search for "merciful"
  quran streak             Show current streak`);
}

import { openDatabase } from "./data/db.ts";

async function launchTui(): Promise<void> {
  openDatabase();
  const [{ default: App }, renderer] = await Promise.all([
    import("./tui/app.tsx"),
    createCliRenderer({
      consoleOptions: {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
        colorInfo: "#00FFFF",
        colorWarn: "#FFFF00",
        colorError: "#FF0000",
        startInDebugMode: false,
      },
    }),
  ]);

  createRoot(renderer).render(createElement(App));
}

async function main(): Promise<number | undefined> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    await launchTui();
    return;
  }

  if (command === "--help" || command === "-h") {
    showUsage();
    return 0;
  }

  if (command === "streak") {
    openDatabase();
    handleStreak();
    return 0;
  }

  if (command === "search") {
    const query = args.slice(1).join(" ");
    const result = handleSearch(query);
    if (result.ok) {
      console.log(result.output);
      return 0;
    } else {
      console.error(result.output);
      return 1;
    }
  }

  if (command !== "read" && command !== "log") {
    console.error(`Error: Unknown command "${command}". Run with --help for usage.`);
    return 1;
  }

  const ref = args[1];
  if (!ref) {
    console.error(`Error: Missing reference. Usage: quran.sh ${command} <ref>`);
    return 1;
  }

  if (command === "log") openDatabase();
  const handler = command === "read" ? handleRead : handleLog;
  const result = handler(ref);
  if (result.ok) {
    console.log(result.output);
    return 0;
  } else {
    console.error(result.output);
    return 1;
  }
}

main()
  .then((exitCode) => {
    if (exitCode !== undefined) process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    console.error("quran.sh failed:", error);
    process.exitCode = 1;
  });
