-- quran.sh: Initial schema migration
-- Tables for reading progress and bookmarks

-- Track reading sessions / verse-by-verse progress
CREATE TABLE IF NOT EXISTS reading_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    surah       INTEGER NOT NULL,              -- Surah number (1-114)
    ayah        INTEGER NOT NULL,              -- Ayah/verse number within surah
    verse_ref   TEXT    NOT NULL,              -- Canonical ref e.g. "2:255"
    read_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    duration_s  INTEGER,                       -- Optional: seconds spent on verse
    UNIQUE(surah, ayah, read_at)
);

-- User bookmarks for quick navigation
CREATE TABLE IF NOT EXISTS bookmarks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    surah       INTEGER NOT NULL,
    ayah        INTEGER NOT NULL,
    verse_ref   TEXT    NOT NULL,              -- "2:255"
    label       TEXT,                          -- Optional user-defined label
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(surah, ayah)                        -- One bookmark per verse
);

-- Indices for common queries
CREATE INDEX IF NOT EXISTS idx_reading_log_verse  ON reading_log(surah, ayah);
CREATE INDEX IF NOT EXISTS idx_reading_log_time   ON reading_log(read_at);
CREATE INDEX IF NOT EXISTS idx_bookmarks_verse    ON bookmarks(surah, ayah);
