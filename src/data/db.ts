/**
 * Database setup for quran.sh
 *
 * Uses bun:sqlite with WAL mode for crash resilience and read concurrency.
 * Database is stored at the XDG data directory: ~/.local/share/quran.sh/
 */
import { Database } from "bun:sqlite";
import { mkdirSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** XDG-compliant data directory */
const xdgDataHome = process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
const APP_DATA_DIR = join(xdgDataHome, "quran.sh");
const DEFAULT_DB_PATH = join(APP_DATA_DIR, "quran.db");

/** Resolve the migrations directory */
let MIGRATIONS_DIR = resolve(import.meta.dir, "..", "..", "migrations");
if (!existsSync(MIGRATIONS_DIR)) {
  // In production (dist/index.js), import.meta.dir is dist/
  MIGRATIONS_DIR = resolve(import.meta.dir, "..", "migrations");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Run all `.sql` migration files in order.
 * Files must be named with a numeric prefix (e.g. `001_init.sql`).
 */
function runMigrations(db: Database): void {
  console.log(`[DB] Checking for migrations in: ${MIGRATIONS_DIR}`);

  if (!existsSync(MIGRATIONS_DIR)) {
    console.warn(`[DB] Migrations directory not found at: ${MIGRATIONS_DIR}`);
    return;
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log(`[DB] No migration files found in ${MIGRATIONS_DIR}`);
    return;
  }

  for (const file of files) {
    console.log(`[DB] Running migration: ${file}`);
    try {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
      db.exec(sql);
      console.log(`[DB] Successfully ran ${file}`);
    } catch (error) {
      console.error(`[DB] Error running migration ${file}:`, error);
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

  console.log(`[DB] Opening database at: ${dbPath}`);

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

export { DEFAULT_DB_PATH, APP_DATA_DIR, MIGRATIONS_DIR };
