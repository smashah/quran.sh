/**
 * Period-based reading statistics for quran.sh
 *
 * Queries the reading_log table with date filters to provide
 * stats for session, today, month, year, or all time.
 */
import { openDatabase } from "./db.ts";
import { getSurah } from "./quran.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeriodStats {
    versesRead: number;
    uniqueVerses: number;
    surahsTouched: number;
    surahsCompleted: number;
}

export type StatsPeriod = "session" | "today" | "month" | "year" | "all";

export const STATS_PERIODS: StatsPeriod[] = ["session", "today", "month", "year", "all"];

export const PERIOD_LABELS: Record<StatsPeriod, string> = {
    session: "Session",
    today: "Today",
    month: "Month",
    year: "Year",
    all: "All Time",
};

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function buildWhereClause(period: StatsPeriod, sessionStart?: string): { clause: string; params: any[] } {
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
 * Get reading statistics for a given time period.
 */
export function getPeriodStats(period: StatsPeriod, sessionStart?: string, dbPath?: string): PeriodStats {
    const db = openDatabase(dbPath);
        const { clause, params } = buildWhereClause(period, sessionStart);

        // Aggregate stats in one query
        const row = db.query(`
      SELECT
        COUNT(*) as versesRead,
        COUNT(DISTINCT verse_ref) as uniqueVerses,
        COUNT(DISTINCT surah) as surahsTouched
      FROM reading_log
      ${clause}
    `).get(...params) as { versesRead: number; uniqueVerses: number; surahsTouched: number } | null;

        if (!row) {
            return { versesRead: 0, uniqueVerses: 0, surahsTouched: 0, surahsCompleted: 0 };
        }

        // Count completed surahs: surahs where distinct ayah count >= total verses
        const surahRows = db.query(`
      SELECT surah, COUNT(DISTINCT ayah) as ayahCount
      FROM reading_log
      ${clause}
      GROUP BY surah
    `).all(...params) as { surah: number; ayahCount: number }[];

        let surahsCompleted = 0;
        for (const sr of surahRows) {
            const surah = getSurah(sr.surah);
            if (surah && sr.ayahCount >= surah.totalVerses) {
                surahsCompleted++;
            }
        }

    return {
            versesRead: row.versesRead,
            uniqueVerses: row.uniqueVerses,
            surahsTouched: row.surahsTouched,
            surahsCompleted,
    };
}
