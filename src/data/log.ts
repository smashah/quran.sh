/**
 * Reading log persistence for quran.sh
 *
 * Inserts reading records into the `reading_log` SQLite table.
 * Uses openDatabase() so the production DB path is consistent.
 */
import { openDatabase } from "./db.ts";
import { getVerse, getSurah as getSurahMeta } from "./quran.ts";
import type { Surah } from "./quran.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogResult {
  ok: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Insert a single reading_log row.
 * Returns the inserted row id.
 */
function insertLogEntry(
  surah: number,
  ayah: number,
  verseRef: string,
): void {
  const db = openDatabase();
  db.query(
    "INSERT INTO reading_log (surah, ayah, verse_ref) VALUES (?, ?, ?)",
  ).run(surah, ayah, verseRef);
}

// ---------------------------------------------------------------------------
// Reset periods (mirrors StatsPeriod for delete operations)
// ---------------------------------------------------------------------------

export type ResetPeriod = "session" | "today" | "month" | "year" | "all";

export const RESET_PERIODS: ResetPeriod[] = ["session", "today", "month", "year", "all"];

export const RESET_LABELS: Record<ResetPeriod, string> = {
  session: "This Session",
  today: "Today",
  month: "This Month",
  year: "This Year",
  all: "All Time",
};

function buildDeleteClause(period: ResetPeriod, sessionStart?: string): { clause: string; params: any[] } {
  switch (period) {
    case "session":
      return { clause: "WHERE read_at >= ?", params: [sessionStart ?? new Date().toISOString()] };
    case "today":
      return { clause: "WHERE date(read_at) = date('now')", params: [] };
    case "month":
      return { clause: "WHERE strftime('%Y-%m', read_at) = strftime('%Y-%m', 'now')", params: [] };
    case "year":
      return { clause: "WHERE strftime('%Y', read_at) = strftime('%Y', 'now')", params: [] };
    case "all":
      return { clause: "", params: [] };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Delete reading log entries for a given time period.
 * Returns the number of rows deleted.
 */
export function deleteReadingLog(period: ResetPeriod, sessionStart?: string): LogResult {
  const db = openDatabase();
  const { clause, params } = buildDeleteClause(period, sessionStart);

  // Count rows to be deleted first
  const countRow = db.query(
    `SELECT COUNT(*) as cnt FROM reading_log ${clause}`,
  ).get(...params) as { cnt: number } | null;
  const count = countRow?.cnt ?? 0;

  if (count === 0) {
    return {
      ok: true,
      message: `No reading data to reset for "${RESET_LABELS[period]}".`,
    };
  }

  db.query(`DELETE FROM reading_log ${clause}`).run(...params);

  return {
    ok: true,
    message: `✓ Reset ${count} reading log entries for "${RESET_LABELS[period]}".`,
  };
}

/**
 * Log a single verse by colon-notation reference (e.g. "2:255").
 */
export function logVerse(ref: string): LogResult {
  const verse = getVerse(ref);
  if (!verse) {
    return {
      ok: false,
      message: `Error: Verse "${ref}" not found. Use format "surah:verse" (e.g. 1:1, 2:255).`,
    };
  }

  insertLogEntry(verse.surahId, verse.verseId, verse.reference);
  return {
    ok: true,
    message: `✓ Logged verse ${verse.reference}`,
  };
}

/**
 * Check whether every verse in a surah has already been logged today.
 * Used as a data-layer safety net to prevent duplicate batch inserts.
 */
export function isSurahLoggedToday(surahId: number, totalVerses: number): boolean {
  const db = openDatabase();
  const row = db.query(
    "SELECT COUNT(DISTINCT ayah) as cnt FROM reading_log WHERE surah = ? AND date(read_at) = date('now')",
  ).get(surahId) as { cnt: number } | null;
  return (row?.cnt ?? 0) >= totalVerses;
}

/**
 * Log every verse in a surah (by numeric ID or transliterated name).
 * Each verse gets its own row for granular progress tracking.
 * Skips insertion if the surah was already fully logged today (issue #5).
 */
export function logSurah(surah: Surah): LogResult {
  // Data-layer dedup: skip if already fully logged today
  if (isSurahLoggedToday(surah.id, surah.totalVerses)) {
    return {
      ok: true,
      message: `✓ Surah ${surah.id} (${surah.transliteration}) already logged today — skipped`,
    };
  }

  const db = openDatabase();
  const stmt = db.query(
    "INSERT INTO reading_log (surah, ayah, verse_ref) VALUES (?, ?, ?)",
  );

  const transaction = db.transaction(() => {
    for (const verse of surah.verses) {
      stmt.run(surah.id, verse.id, `${surah.id}:${verse.id}`);
    }
  });

  transaction();

  return {
    ok: true,
    message: `✓ Logged ${surah.totalVerses} verses from Surah ${surah.id} (${surah.transliteration})`,
  };
}

// ---------------------------------------------------------------------------
// Completion queries (issue #4)
// ---------------------------------------------------------------------------

/**
 * Get the set of surah IDs that have been fully read (all-time).
 * A surah is "completed" when COUNT(DISTINCT ayah) >= its total verse count.
 */
export function getCompletedSurahIds(): Set<number> {
  const db = openDatabase();
  const rows = db.query(
    "SELECT surah, COUNT(DISTINCT ayah) as cnt FROM reading_log GROUP BY surah",
  ).all() as { surah: number; cnt: number }[];

  const completed = new Set<number>();
  for (const row of rows) {
    const surah = getSurahMeta(row.surah);
    if (surah && row.cnt >= surah.totalVerses) {
      completed.add(row.surah);
    }
  }
  return completed;
}

/**
 * Get the set of ayah IDs that have been read for a given surah (all-time).
 */
export function getReadVerseIds(surahId: number): Set<number> {
  const db = openDatabase();
  const rows = db.query(
    "SELECT DISTINCT ayah FROM reading_log WHERE surah = ?",
  ).all(surahId) as { ayah: number }[];
  return new Set(rows.map((r) => r.ayah));
}
