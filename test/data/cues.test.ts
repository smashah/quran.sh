import { describe, expect, test, afterAll } from "bun:test";
import { setCue, getCue, getAllCues, clearCue } from "../../src/data/cues.ts";
import { createTempDatabase } from "../helpers/temp-database.ts";

const testDatabase = createTempDatabase("quran-sh-cues");
const TEST_DB = testDatabase.path;

describe("Cues Data Layer", () => {
  afterAll(() => {
    testDatabase.cleanup();
  });

  test("setCue and getCue", () => {
    setCue(1, 2, 255, "2:255", TEST_DB);
    const cue = getCue(1, TEST_DB);
    expect(cue).not.toBeNull();
    expect(cue!.surah).toBe(2);
    expect(cue!.ayah).toBe(255);
    expect(cue!.verseRef).toBe("2:255");
  });

  test("setCue overwrites existing slot", () => {
    setCue(1, 1, 1, "1:1", TEST_DB);
    const cue = getCue(1, TEST_DB);
    expect(cue!.verseRef).toBe("1:1");
  });

  test("getCue returns null for empty slot", () => {
    const cue = getCue(5, TEST_DB);
    expect(cue).toBeNull();
  });

  test("getAllCues returns all set cues", () => {
    setCue(2, 3, 1, "3:1", TEST_DB);
    const all = getAllCues(TEST_DB);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.find(c => c.slot === 1)).toBeDefined();
    expect(all.find(c => c.slot === 2)).toBeDefined();
  });

  test("clearCue removes a cue", () => {
    clearCue(1, TEST_DB);
    const cue = getCue(1, TEST_DB);
    expect(cue).toBeNull();
  });

  test("slot validation", () => {
    expect(() => setCue(0, 1, 1, "1:1", TEST_DB)).toThrow();
    expect(() => setCue(10, 1, 1, "1:1", TEST_DB)).toThrow();
  });
});
