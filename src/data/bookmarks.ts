/**
 * Bookmark persistence for quran.sh
 *
 * CRUD operations for the `bookmarks` SQLite table.
 * Uses openDatabase() so the production DB path is consistent.
 */
import { openDatabase } from "./db.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Bookmark {
  id: number;
  surah: number;
  ayah: number;
  verseRef: string;
  label: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a bookmark for a specific verse.
 * Uses INSERT OR IGNORE to respect the UNIQUE(surah, ayah) constraint —
 * silently does nothing if the bookmark already exists.
 */
export function addBookmark(
  surahId: number,
  ayahId: number,
  verseRef: string,
  label?: string,
): void {
  const db = openDatabase();
  try {
    db.query(
      "INSERT OR IGNORE INTO bookmarks (surah, ayah, verse_ref, label) VALUES (?, ?, ?, ?)",
    ).run(surahId, ayahId, verseRef, label ?? null);
  } finally {
  }
}

/**
 * Remove a bookmark for a specific verse.
 */
export function removeBookmark(surahId: number, ayahId: number): void {
  const db = openDatabase();
  try {
    db.query("DELETE FROM bookmarks WHERE surah = ? AND ayah = ?").run(
      surahId,
      ayahId,
    );
  } finally {
  }
}

/**
 * Check if a specific verse is bookmarked.
 * Returns the bookmark row if it exists, or null otherwise.
 */
export function getBookmark(
  surahId: number,
  ayahId: number,
): Bookmark | null {
  const db = openDatabase();
  try {
    const row = db
      .query(
        "SELECT id, surah, ayah, verse_ref, label, created_at FROM bookmarks WHERE surah = ? AND ayah = ?",
      )
      .get(surahId, ayahId) as Record<string, unknown> | null;

    if (!row) return null;

    return {
      id: row["id"] as number,
      surah: row["surah"] as number,
      ayah: row["ayah"] as number,
      verseRef: row["verse_ref"] as string,
      label: row["label"] as string | null,
      createdAt: row["created_at"] as string,
    };
  } finally {
  }
}

/**
 * Toggle a bookmark: add if it doesn't exist, remove if it does.
 * Returns `true` if the bookmark was added, `false` if removed.
 */
export function toggleBookmark(
  surahId: number,
  ayahId: number,
  verseRef: string,
  label?: string,
): boolean {
  const existing = getBookmark(surahId, ayahId);
  if (existing) {
    removeBookmark(surahId, ayahId);
    return false;
  }
  addBookmark(surahId, ayahId, verseRef, label);
  return true;
}

/**
 * Get all bookmarks, ordered by creation time (newest first).
 */
export function getAllBookmarks(): Bookmark[] {
  const db = openDatabase();
  try {
    const rows = db
      .query(
        "SELECT id, surah, ayah, verse_ref, label, created_at FROM bookmarks ORDER BY created_at DESC",
      )
      .all() as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row["id"] as number,
      surah: row["surah"] as number,
      ayah: row["ayah"] as number,
      verseRef: row["verse_ref"] as string,
      label: row["label"] as string | null,
      createdAt: row["created_at"] as string,
    }));
  } finally {
  }
}

/**
 * Get all bookmarked ayah IDs for a specific surah.
 * Returns a Set for O(1) lookup when rendering verse indicators.
 */
export function getBookmarkedAyahs(surahId: number): Set<number> {
  const db = openDatabase();
  try {
    const rows = db
      .query("SELECT ayah FROM bookmarks WHERE surah = ?")
      .all(surahId) as Record<string, unknown>[];

    return new Set(rows.map((row) => row["ayah"] as number));
  } finally {
  }
}
