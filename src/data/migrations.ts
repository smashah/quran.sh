import initialSchema from "./migrations/001_init.sql" with { type: "text" };
import userPreferences from "./migrations/002_user_preferences.sql" with { type: "text" };
import cuesAndReflections from "./migrations/003_cues_reflections.sql" with { type: "text" };

export interface Migration {
  name: string;
  sql: string;
}

/** Ordered, bundled migrations used by both the package and standalone binary. */
export const MIGRATIONS: readonly Migration[] = [
  { name: "001_init.sql", sql: initialSchema },
  { name: "002_user_preferences.sql", sql: userPreferences },
  { name: "003_cues_reflections.sql", sql: cuesAndReflections },
];
