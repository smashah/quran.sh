import { test, expect, describe, beforeEach, afterAll } from "bun:test";
import { createTempDatabase } from "../helpers/temp-database.ts";

// We test via the data layer directly with a temp DB
const testDatabase = createTempDatabase("quran-sh-stats");
const TEST_DB_PATH = testDatabase.path;

import { openDatabase, closeDatabase } from "../../src/data/db.ts";
import { getPeriodStats } from "../../src/data/stats.ts";

function seedDatabase() {
    const db = openDatabase(TEST_DB_PATH);
    // Insert some verse logs across different dates
    const stmt = db.query(
        "INSERT INTO reading_log (surah, ayah, verse_ref, read_at) VALUES (?, ?, ?, ?)"
    );

    const now = new Date();
    const today = now.toISOString();
    const yesterday = new Date(now.getTime() - 86400000).toISOString();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString();

    // Today: 3 verses from surah 1 (Al-Fatiha has 7 verses)
    stmt.run(1, 1, "1:1", today);
    stmt.run(1, 2, "1:2", today);
    stmt.run(1, 3, "1:3", today);

    // Yesterday: 2 verses from surah 2
    stmt.run(2, 1, "2:1", yesterday);
    stmt.run(2, 2, "2:2", yesterday);

    // Last month: 1 verse from surah 3
    stmt.run(3, 1, "3:1", lastMonth);
}

describe("stats data layer", () => {
    beforeEach(() => {
        const db = openDatabase(TEST_DB_PATH);
        db.exec("DELETE FROM reading_log");
        seedDatabase();
    });

    afterAll(() => {
        testDatabase.cleanup();
    });

    test("getPeriodStats('all') returns all log entries", () => {
        // We need to ensure the test uses the right DB
        // For now this is a structural test to verify the query shape
        const stats = getPeriodStats("all", undefined, TEST_DB_PATH);
        expect(stats).toHaveProperty("versesRead");
        expect(stats).toHaveProperty("uniqueVerses");
        expect(stats).toHaveProperty("surahsTouched");
        expect(stats).toHaveProperty("surahsCompleted");
        expect(typeof stats.versesRead).toBe("number");
        expect(typeof stats.uniqueVerses).toBe("number");
        expect(typeof stats.surahsTouched).toBe("number");
        expect(typeof stats.surahsCompleted).toBe("number");
    });

    test("getPeriodStats returns zero stats when no data", () => {
        // Clean the DB
        const db = openDatabase(TEST_DB_PATH);
        db.exec("DELETE FROM reading_log");
        const stats = getPeriodStats("all", undefined, TEST_DB_PATH);
        expect(stats.versesRead).toBe(0);
        expect(stats.uniqueVerses).toBe(0);
        expect(stats.surahsTouched).toBe(0);
        expect(stats.surahsCompleted).toBe(0);
    });

    test("all period types return valid PeriodStats", () => {
        const periods = ["session", "today", "month", "year", "all"] as const;
        for (const period of periods) {
            const stats = getPeriodStats(period, new Date().toISOString(), TEST_DB_PATH);
            expect(stats).toHaveProperty("versesRead");
            expect(stats.versesRead).toBeGreaterThanOrEqual(0);
        }
    });
});
