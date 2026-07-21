-- Cues: 1-9 quick navigation slots
CREATE TABLE IF NOT EXISTS cues (
    slot     INTEGER PRIMARY KEY CHECK(slot BETWEEN 1 AND 9),
    surah    INTEGER NOT NULL,
    ayah     INTEGER NOT NULL,
    verse_ref TEXT NOT NULL,
    set_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Reflections: bookmarks with user notes
CREATE TABLE IF NOT EXISTS reflections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    surah      INTEGER NOT NULL,
    ayah       INTEGER NOT NULL,
    verse_ref  TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(surah, ayah)
);

CREATE INDEX IF NOT EXISTS idx_reflections_verse ON reflections(surah, ayah);
