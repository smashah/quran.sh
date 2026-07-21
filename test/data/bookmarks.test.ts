import { describe, expect, it, beforeEach, afterEach, afterAll } from "bun:test";
import {
  addBookmark as addBookmarkData,
  removeBookmark as removeBookmarkData,
  getBookmark as getBookmarkData,
  toggleBookmark as toggleBookmarkData,
  getAllBookmarks as getAllBookmarksData,
  getBookmarkedAyahs as getBookmarkedAyahsData,
} from "../../src/data/bookmarks";
import { openDatabase } from "../../src/data/db.ts";
import { createTempDatabase } from "../helpers/temp-database.ts";

const testDatabase = createTempDatabase("quran-sh-bookmarks");
const TEST_DB_PATH = testDatabase.path;

const addBookmark = (surah: number, ayah: number, verseRef: string, label?: string) =>
  addBookmarkData(surah, ayah, verseRef, label, TEST_DB_PATH);
const removeBookmark = (surah: number, ayah: number) =>
  removeBookmarkData(surah, ayah, TEST_DB_PATH);
const getBookmark = (surah: number, ayah: number) =>
  getBookmarkData(surah, ayah, TEST_DB_PATH);
const toggleBookmark = (surah: number, ayah: number, verseRef: string, label?: string) =>
  toggleBookmarkData(surah, ayah, verseRef, label, TEST_DB_PATH);
const getAllBookmarks = () => getAllBookmarksData(TEST_DB_PATH);
const getBookmarkedAyahs = (surah: number) => getBookmarkedAyahsData(surah, TEST_DB_PATH);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanDb(): void {
  // Truncate the bookmarks table rather than deleting the file,
  // because WAL journaling can hold data across file unlink/recreate cycles
  try {
    const db = openDatabase(TEST_DB_PATH);
    db.exec("DELETE FROM bookmarks");
  } catch {
    // If DB doesn't exist yet, that's fine
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("bookmarks", () => {
  beforeEach(() => {
    cleanDb();
  });

  afterEach(() => {
    cleanDb();
  });

  afterAll(() => {
    testDatabase.cleanup();
  });

  // -------------------------------------------------------------------------
  // addBookmark
  // -------------------------------------------------------------------------

  describe("addBookmark", () => {
    it("adds a bookmark for a verse", () => {
      addBookmark(1, 1, "1:1");
      const bm = getBookmark(1, 1);
      expect(bm).not.toBeNull();
      expect(bm!.surah).toBe(1);
      expect(bm!.ayah).toBe(1);
      expect(bm!.verseRef).toBe("1:1");
      expect(bm!.label).toBeNull();
    });

    it("adds a bookmark with a label", () => {
      addBookmark(2, 255, "2:255", "Ayat al-Kursi");
      const bm = getBookmark(2, 255);
      expect(bm).not.toBeNull();
      expect(bm!.label).toBe("Ayat al-Kursi");
    });

    it("silently ignores duplicate bookmark (INSERT OR IGNORE)", () => {
      addBookmark(1, 1, "1:1");
      addBookmark(1, 1, "1:1"); // should not throw
      const all = getAllBookmarks();
      const matches = all.filter((b) => b.surah === 1 && b.ayah === 1);
      expect(matches).toHaveLength(1);
    });

    it("allows bookmarks for different verses", () => {
      addBookmark(1, 1, "1:1");
      addBookmark(1, 2, "1:2");
      addBookmark(2, 1, "2:1");
      const all = getAllBookmarks();
      expect(all).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // removeBookmark
  // -------------------------------------------------------------------------

  describe("removeBookmark", () => {
    it("removes an existing bookmark", () => {
      addBookmark(1, 1, "1:1");
      expect(getBookmark(1, 1)).not.toBeNull();
      removeBookmark(1, 1);
      expect(getBookmark(1, 1)).toBeNull();
    });

    it("does nothing when removing a non-existent bookmark", () => {
      expect(() => removeBookmark(99, 99)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // getBookmark
  // -------------------------------------------------------------------------

  describe("getBookmark", () => {
    it("returns null for a non-existent bookmark", () => {
      expect(getBookmark(1, 1)).toBeNull();
    });

    it("returns the bookmark with correct shape", () => {
      addBookmark(2, 255, "2:255", "Throne Verse");
      const bm = getBookmark(2, 255);
      expect(bm).not.toBeNull();
      expect(bm).toHaveProperty("id");
      expect(bm).toHaveProperty("surah");
      expect(bm).toHaveProperty("ayah");
      expect(bm).toHaveProperty("verseRef");
      expect(bm).toHaveProperty("label");
      expect(bm).toHaveProperty("createdAt");
      expect(bm!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // -------------------------------------------------------------------------
  // toggleBookmark
  // -------------------------------------------------------------------------

  describe("toggleBookmark", () => {
    it("adds a bookmark when none exists (returns true)", () => {
      const result = toggleBookmark(1, 1, "1:1");
      expect(result).toBe(true);
      expect(getBookmark(1, 1)).not.toBeNull();
    });

    it("removes a bookmark when one exists (returns false)", () => {
      addBookmark(1, 1, "1:1");
      const result = toggleBookmark(1, 1, "1:1");
      expect(result).toBe(false);
      expect(getBookmark(1, 1)).toBeNull();
    });

    it("round-trips: add → remove → add", () => {
      expect(toggleBookmark(1, 1, "1:1")).toBe(true);
      expect(toggleBookmark(1, 1, "1:1")).toBe(false);
      expect(toggleBookmark(1, 1, "1:1")).toBe(true);
      expect(getBookmark(1, 1)).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getAllBookmarks
  // -------------------------------------------------------------------------

  describe("getAllBookmarks", () => {
    it("returns empty array when no bookmarks exist", () => {
      expect(getAllBookmarks()).toEqual([]);
    });

    it("returns all bookmarks", () => {
      addBookmark(1, 1, "1:1");
      addBookmark(2, 255, "2:255");
      addBookmark(114, 1, "114:1");
      const all = getAllBookmarks();
      expect(all).toHaveLength(3);
    });

    it("returns bookmarks with correct Bookmark shape", () => {
      addBookmark(1, 1, "1:1", "First verse");
      const all = getAllBookmarks();
      expect(all).toHaveLength(1);
      const bm = all[0]!;
      expect(bm.surah).toBe(1);
      expect(bm.ayah).toBe(1);
      expect(bm.verseRef).toBe("1:1");
      expect(bm.label).toBe("First verse");
    });
  });

  // -------------------------------------------------------------------------
  // getBookmarkedAyahs
  // -------------------------------------------------------------------------

  describe("getBookmarkedAyahs", () => {
    it("returns empty set when no bookmarks exist for surah", () => {
      const set = getBookmarkedAyahs(1);
      expect(set.size).toBe(0);
    });

    it("returns set of ayah IDs for a surah", () => {
      addBookmark(1, 1, "1:1");
      addBookmark(1, 3, "1:3");
      addBookmark(1, 7, "1:7");
      const set = getBookmarkedAyahs(1);
      expect(set.size).toBe(3);
      expect(set.has(1)).toBe(true);
      expect(set.has(3)).toBe(true);
      expect(set.has(7)).toBe(true);
      expect(set.has(2)).toBe(false);
    });

    it("only returns ayahs for the requested surah", () => {
      addBookmark(1, 1, "1:1");
      addBookmark(2, 1, "2:1");
      const set1 = getBookmarkedAyahs(1);
      const set2 = getBookmarkedAyahs(2);
      expect(set1.size).toBe(1);
      expect(set1.has(1)).toBe(true);
      expect(set2.size).toBe(1);
      expect(set2.has(1)).toBe(true);
    });
  });
});
