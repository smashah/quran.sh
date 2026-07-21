/**
 * Cue persistence for quran.sh
 *
 * CRUD operations for the `cues` SQLite table (1-9 quick navigation slots).
 * Follows the same open-close-per-call pattern as bookmarks.ts.
 */
import { openDatabase } from "./db.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Cue {
  slot: number;
  surah: number;
  ayah: number;
  verseRef: string;
  setAt: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Set a cue in a specific slot (1-9).
 * Overwrites any existing cue in that slot.
 */
export function setCue(
  slot: number,
  surahId: number,
  ayahId: number,
  verseRef: string,
  dbPath?: string,
): void {
  if (slot < 1 || slot > 9) {
    throw new Error("Cue slot must be between 1 and 9");
  }

  const db = openDatabase(dbPath);
  db.query(
    "INSERT OR REPLACE INTO cues (slot, surah, ayah, verse_ref) VALUES (?, ?, ?, ?)",
  ).run(slot, surahId, ayahId, verseRef);
}

/**
 * Retrieve a cue from a specific slot.
 * Returns null if the slot is empty.
 */
export function getCue(slot: number, dbPath?: string): Cue | null {
  const db = openDatabase(dbPath);
  const row = db
    .query("SELECT slot, surah, ayah, verse_ref, set_at FROM cues WHERE slot = ?")
    .get(slot) as Record<string, unknown> | null;

  if (!row) return null;

  return {
    slot: row["slot"] as number,
    surah: row["surah"] as number,
    ayah: row["ayah"] as number,
    verseRef: row["verse_ref"] as string,
    setAt: row["set_at"] as string,
  };
}

/**
 * Get all set cues.
 */
export function getAllCues(dbPath?: string): Cue[] {
  const db = openDatabase(dbPath);
  const rows = db
    .query("SELECT slot, surah, ayah, verse_ref, set_at FROM cues ORDER BY slot ASC")
    .all() as Record<string, unknown>[];

  return rows.map((row) => ({
    slot: row["slot"] as number,
    surah: row["surah"] as number,
    ayah: row["ayah"] as number,
    verseRef: row["verse_ref"] as string,
    setAt: row["set_at"] as string,
  }));
}

/**
 * Clear a cue slot.
 */
export function clearCue(slot: number, dbPath?: string): void {
  const db = openDatabase(dbPath);
  db.query("DELETE FROM cues WHERE slot = ?").run(slot);
}
