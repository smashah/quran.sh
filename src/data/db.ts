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

/**
 * Resolve the migrations directory by walking up from this file until we find
 * package.json (the package root), then appending "migrations/".
 *
 * This works for both layouts:
 *   - Development: src/data/db.ts  → walk up to find package.json → ./migrations/
 *   - Bundled:     dist/index.js   → walk up to find package.json → ./migrations/
 *
 * The previous approach (resolve(import.meta.dir, "..", "..", "migrations"))
 * only worked from src/data/ depth and broke when running from dist/.
 */
function findMigrationsDir(): string {
  let dir = import.meta.dir;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "package.json"))) {
      return join(dir, "migrations");
    }
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  // Fallback to the old behaviour
  return resolve(import.meta.dir, "..", "..", "migrations");
}

const MIGRATIONS_DIR = findMigrationsDir();

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
  if (!existsSync(MIGRATIONS_DIR)) return;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    db.exec(sql);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open (or create) the quran.sh SQLite database.
 *
 * @param dbPath - Override path for testing. Defaults to XDG data dir.
 * @returns A configured `Database` instance with WAL mode enabled and
 *          migrations applied.
 */
export function openDatabase(dbPath: string = DEFAULT_DB_PATH): Database {
  // Ensure parent directory exists
  ensureDir(dirname(dbPath));

  const db = new Database(dbPath, { create: true });

  // Enable WAL mode for better concurrency & crash resilience
  db.exec("PRAGMA journal_mode = WAL;");
  // Recommended pragmas for bun:sqlite
  db.exec("PRAGMA foreign_keys = ON;");

  // Run schema migrations
  runMigrations(db);

  return db;
}

export { DEFAULT_DB_PATH, APP_DATA_DIR, MIGRATIONS_DIR };
