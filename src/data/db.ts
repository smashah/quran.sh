/**
 * Database setup for quran.sh
 *
 * Uses bun:sqlite with WAL mode for crash resilience and read concurrency.
 * Database is stored at the XDG data directory: ~/.local/share/quran.sh/
 */
import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { MIGRATIONS } from "./migrations.ts";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** XDG-compliant data directory */
const xdgDataHome = process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
const APP_DATA_DIR = join(xdgDataHome, "quran.sh");
const DEFAULT_DB_PATH = join(APP_DATA_DIR, "quran.db");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Run each bundled migration exactly once and record it atomically.
 */
function runMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  const appliedRows = db
    .query<{ name: string }, []>("SELECT name FROM schema_migrations")
    .all();
  const applied = new Set(appliedRows.map((row) => row.name));

  const recordMigration = db.prepare(
    "INSERT INTO schema_migrations (name) VALUES (?)",
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;

    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(migration.sql);
      recordMigration.run(migration.name);
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // SQLite may already have rolled back a failed transaction.
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton cache — one Database instance per path
// ---------------------------------------------------------------------------

const dbCache = new Map<string, Database>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open (or create) the quran.sh SQLite database.
 *
 * Returns a cached instance if the same path was already opened, so
 * migrations only run once regardless of how many modules import this.
 *
 * @param dbPath - Override path for testing. Defaults to XDG data dir.
 * @returns A configured `Database` instance with WAL mode enabled and
 *          migrations applied.
 */
export function openDatabase(dbPath: string = DEFAULT_DB_PATH): Database {
  const cached = dbCache.get(dbPath);
  if (cached) return cached;

  // Ensure parent directory exists
  ensureDir(dirname(dbPath));

  const db = new Database(dbPath, { create: true });

  // Enable WAL mode for better concurrency & crash resilience
  db.exec("PRAGMA journal_mode = WAL;");
  // Recommended pragmas for bun:sqlite
  db.exec("PRAGMA foreign_keys = ON;");

  // Run schema migrations
  runMigrations(db);

  dbCache.set(dbPath, db);
  return db;
}

/**
 * Close a cached database and evict it from the singleton cache.
 * Useful for tests that need a fresh database between runs.
 */
export function closeDatabase(dbPath: string = DEFAULT_DB_PATH): void {
  const cached = dbCache.get(dbPath);
  if (cached) {
    cached.close();
    dbCache.delete(dbPath);
  }
}

export { DEFAULT_DB_PATH, APP_DATA_DIR };
