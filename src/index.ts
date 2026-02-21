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
import App from "./tui/app.tsx";

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

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Ensure DB is setup and migrations applied before executing any command
  try {
    openDatabase();
  } catch (error) {
    console.error("Failed to initialize database:", error);
    process.exit(1);
  }

  if (!command) {
    // Launch TUI
    const renderer = await createCliRenderer({
      consoleOptions: {
        position: ConsolePosition.BOTTOM, // Position on screen
        sizePercent: 30, // Size as percentage of terminal
        colorInfo: "#00FFFF", // Color for console.info
        colorWarn: "#FFFF00", // Color for console.warn
        colorError: "#FF0000", // Color for console.error
        startInDebugMode: false, // Show file/line info in logs
      },
    });
    // renderer.console.toggle()
    createRoot(renderer).render(createElement(App));
    return;
  }

  if (command === "--help" || command === "-h") {
    showUsage();
    process.exit(0);
  }

  if (command === "streak") {
    handleStreak();
    process.exit(0);
  }

  if (command === "search") {
    const query = args.slice(1).join(" ");
    const result = handleSearch(query);
    if (result.ok) {
      console.log(result.output);
      process.exit(0);
    } else {
      console.error(result.output);
      process.exit(1);
    }
  }

  if (command !== "read" && command !== "log") {
    console.error(`Error: Unknown command "${command}". Run with --help for usage.`);
    process.exit(1);
  }

  const ref = args[1];
  if (!ref) {
    console.error(`Error: Missing reference. Usage: quran.sh ${command} <ref>`);
    process.exit(1);
  }

  const handler = command === "read" ? handleRead : handleLog;
  const result = handler(ref);
  if (result.ok) {
    console.log(result.output);
    process.exit(0);
  } else {
    console.error(result.output);
    process.exit(1);
  }
}

main();
