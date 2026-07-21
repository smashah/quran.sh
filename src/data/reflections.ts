/**
 * Reflection persistence for quran.sh
 *
 * CRUD operations for the `reflections` SQLite table (bookmarks with user notes).
 * Follows the same open-close-per-call pattern as bookmarks.ts.
 */
import { openDatabase } from "./db.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Reflection {
  id: number;
  surah: number;
  ayah: number;
  verseRef: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a reflection for a specific verse.
 * Uses INSERT OR REPLACE to handle duplicates.
 */
export function addReflection(
  surahId: number,
  ayahId: number,
  verseRef: string,
  note: string,
  dbPath?: string,
): void {
  const db = openDatabase(dbPath);
  db.query(
    "INSERT OR REPLACE INTO reflections (surah, ayah, verse_ref, note) VALUES (?, ?, ?, ?)",
  ).run(surahId, ayahId, verseRef, note);
}

/**
 * Retrieve a reflection for a specific verse.
 */
export function getReflection(
  surahId: number,
  ayahId: number,
  dbPath?: string,
): Reflection | null {
  const db = openDatabase(dbPath);
  const row = db
    .query(
      "SELECT id, surah, ayah, verse_ref, note, created_at, updated_at FROM reflections WHERE surah = ? AND ayah = ?",
    )
    .get(surahId, ayahId) as Record<string, unknown> | null;

  if (!row) return null;

  return {
    id: row["id"] as number,
    surah: row["surah"] as number,
    ayah: row["ayah"] as number,
    verseRef: row["verse_ref"] as string,
    note: row["note"] as string,
    createdAt: row["created_at"] as string,
    updatedAt: row["updated_at"] as string,
  };
}

/**
 * Update the note of an existing reflection.
 */
export function updateReflection(
  surahId: number,
  ayahId: number,
  note: string,
  dbPath?: string,
): void {
  const db = openDatabase(dbPath);
  db.query(
    "UPDATE reflections SET note = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE surah = ? AND ayah = ?",
  ).run(note, surahId, ayahId);
}

/**
 * Remove a reflection.
 */
export function removeReflection(
  surahId: number,
  ayahId: number,
  dbPath?: string,
): void {
  const db = openDatabase(dbPath);
  db.query("DELETE FROM reflections WHERE surah = ? AND ayah = ?").run(
    surahId,
    ayahId,
  );
}

/**
 * Get all reflections, ordered by creation (newest first).
 */
export function getAllReflections(dbPath?: string): Reflection[] {
  const db = openDatabase(dbPath);
  const rows = db
    .query(
      "SELECT id, surah, ayah, verse_ref, note, created_at, updated_at FROM reflections ORDER BY created_at DESC",
    )
    .all() as Record<string, unknown>[];

  return rows.map((row) => ({
    id: row["id"] as number,
    surah: row["surah"] as number,
    ayah: row["ayah"] as number,
    verseRef: row["verse_ref"] as string,
    note: row["note"] as string,
    createdAt: row["created_at"] as string,
    updatedAt: row["updated_at"] as string,
  }));
}

/**
 * Get reflections for a specific surah.
 */
export function getReflectionsForSurah(
  surahId: number,
  dbPath?: string,
): Reflection[] {
  const db = openDatabase(dbPath);
  const rows = db
    .query(
      "SELECT id, surah, ayah, verse_ref, note, created_at, updated_at FROM reflections WHERE surah = ? ORDER BY ayah ASC",
    )
    .all(surahId) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: row["id"] as number,
    surah: row["surah"] as number,
    ayah: row["ayah"] as number,
    verseRef: row["verse_ref"] as string,
    note: row["note"] as string,
    createdAt: row["created_at"] as string,
    updatedAt: row["updated_at"] as string,
  }));
}
