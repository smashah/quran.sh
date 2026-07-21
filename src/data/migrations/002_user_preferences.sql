-- quran.sh: User preferences migration
-- Generic key-value store for user settings (theme, etc.)

CREATE TABLE IF NOT EXISTS user_preferences (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
