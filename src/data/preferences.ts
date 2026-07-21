/**
 * User preferences persistence for quran.sh
 *
 * Generic key-value store backed by the `user_preferences` SQLite table.
 * Follows the same open-close-per-call pattern as bookmarks.ts.
 */
import { openDatabase } from "./db.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read a preference value by key.
 * Returns `null` if the key has never been set.
 */
export function getPreference(key: string): string | null {
  const db = openDatabase();
  const row = db
    .query("SELECT value FROM user_preferences WHERE key = ?")
    .get(key) as Record<string, unknown> | null;

  return row ? (row["value"] as string) : null;
}

/**
 * Write (upsert) a preference value.
 * Uses INSERT OR REPLACE so existing keys are updated in place.
 */
export function setPreference(key: string, value: string): void {
  const db = openDatabase();
  db.query("INSERT OR REPLACE INTO user_preferences (key, value) VALUES (?, ?)").run(
    key,
    value,
  );
}
