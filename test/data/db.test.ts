import { afterEach, describe, expect, test } from "bun:test";
import { closeDatabase, openDatabase } from "../../src/data/db.ts";
import { MIGRATIONS } from "../../src/data/migrations.ts";
import { createTempDatabase } from "../helpers/temp-database.ts";

const tempDatabases: Array<ReturnType<typeof createTempDatabase>> = [];

afterEach(() => {
  for (const database of tempDatabases.splice(0)) database.cleanup();
});

describe("database migrations", () => {
  test("records every bundled migration exactly once", () => {
    const database = createTempDatabase("quran-sh-migrations");
    tempDatabases.push(database);
    const path = database.path;
    const db = openDatabase(path);
    const firstRun = db
      .query<{ name: string }, []>("SELECT name FROM schema_migrations ORDER BY name")
      .all();

    expect(firstRun.map((row) => row.name)).toEqual(MIGRATIONS.map((migration) => migration.name));

    closeDatabase(path);
    const reopened = openDatabase(path);
    const secondRun = reopened
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM schema_migrations")
      .get();

    expect(secondRun?.count).toBe(MIGRATIONS.length);
    closeDatabase(path);
  });
});
