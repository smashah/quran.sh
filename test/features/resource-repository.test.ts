import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openResourceRepository } from "../../src/features/resources/repository.ts";
import { activeTimedWord, validateWordTimings, wordTimingsFromSegments } from "../../src/features/resources/timing.ts";
import { buildMushafPageScene } from "../../src/features/resources/mushaf.ts";

describe("QUL repositories", () => {
  test("joins study rows by canonical verse and word coordinates", async () => {
    const root = await mkdtemp(join(tmpdir(), "quran-pack-"));
    try {
      const dataPath = join(root, "data.json");
      await writeFile(dataPath, JSON.stringify([
        { verse_key: "1:1", location: "1:1:1", text: "بِسْمِ", root: "س م و" },
        { verse_key: "1:1", location: "1:1:2", text: "ٱللَّهِ", root: "أ ل ه" },
      ]));
      const repository = await openResourceRepository({
        dataPath,
        directory: root,
        manifest: { kind: "morphology", format: "json" } as never,
      });
      expect(repository.verse("1:1")).toHaveLength(2);
      expect(repository.word("1:1:2")[0]?.root).toBe("أ ل ه");
      expect(repository.search("س م و")).toHaveLength(1);
      repository.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("finds timed words with a binary search and rejects overlap", () => {
    const timings = [
      { wordKey: "1:1:1" as const, startMs: 0, endMs: 500 },
      { wordKey: "1:1:2" as const, startMs: 500, endMs: 900 },
    ];
    expect(validateWordTimings(timings)).toEqual({ ok: true });
    expect(activeTimedWord(timings, 700)).toBe("1:1:2");
    expect(validateWordTimings([{ ...timings[1]!, startMs: 400 }])).toEqual({ ok: true });
    expect(validateWordTimings([timings[0]!, { ...timings[1]!, startMs: 400 }]).ok).toBe(false);
    expect(wordTimingsFromSegments("1:1", [[1, 0, 500], [2, 500, 900]])?.map((timing) => timing.wordKey)).toEqual(["1:1:1", "1:1:2"]);
    expect(wordTimingsFromSegments("1:999", [[1, 0, 500]])).toBeNull();
  });

  test("builds a followable Mushaf page with RTL word order", () => {
    const scene = buildMushafPageScene([
      { wordKey: "1:1:1", verseKey: "1:1", page: 1, line: 1, x: 9, text: "بسم" },
      { wordKey: "1:1:2", verseKey: "1:1", page: 1, line: 1, x: 4, text: "الله" },
      { wordKey: "1:2:1", verseKey: "1:2", page: 1, line: 2, x: 9, text: "الحمد" },
    ], 1, "1:2");
    expect(scene.lines[0]?.words.map((word) => word.wordKey)).toEqual(["1:1:1", "1:1:2"]);
    expect(scene.lines[1]).toMatchObject({ active: true, completed: false });
  });
});
