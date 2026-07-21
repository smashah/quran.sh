import { describe, expect, test } from "bun:test";
import { createFollowCoordinator } from "../../src/features/recognition/follow-coordinator.ts";
import type { AudioCapture } from "../../src/features/capture/audio-capture.ts";
import type { TilawaRecognizer } from "../../src/features/recognition/types.ts";

describe("follow my recitation", () => {
  test("shows candidates but navigates only on committed matches", async () => {
    let stopped = 0;
    const capture: AudioCapture = {
      name: "fixture",
      available: async () => true,
      start: async () => ({
        async *[Symbol.asyncIterator]() { yield { samples: new Float32Array(3), sampleRate: 16_000 as const, capturedAt: 0 }; },
        async stop() { stopped++; },
      }),
    };
    let feed = 0;
    const recognizer: TilawaRecognizer = {
      feed: async () => feed++ === 0
        ? [{ type: "candidate", verseKey: "2:255", confidence: 0.9, stable: true }]
        : [],
      reset: () => {},
      dispose: async () => {},
    };
    const navigation: string[] = [];
    const coordinator = createFollowCoordinator({ capture, recognizer, navigate: (key) => navigation.push(key) });
    await coordinator.start();
    await Bun.sleep(1);
    expect(coordinator.getState().candidate).toBe("2:255");
    expect(navigation).toEqual([]);
    await coordinator.stop();
    expect(stopped).toBe(1);
  });

  test("deduplicates rapid committed matches and falls back from ambiguous words", async () => {
    let now = 1_000;
    const events = [
      { type: "match", verseKey: "1:1", confidence: 0.9 },
      { type: "match", verseKey: "1:1", confidence: 0.9 },
      { type: "word-progress", verseKey: "1:1", wordKey: "1:1:2", sourceIndexes: [1] },
    ] as const;
    const capture: AudioCapture = {
      name: "fixture", available: async () => true,
      start: async () => ({ async *[Symbol.asyncIterator]() { yield { samples: new Float32Array([0]), sampleRate: 16_000 as const, capturedAt: 0 }; }, async stop() {} }),
    };
    const recognizer: TilawaRecognizer = { feed: async () => events, reset() {}, async dispose() {} };
    const navigation: string[] = [];
    const coordinator = createFollowCoordinator({ capture, recognizer, navigate: (key) => navigation.push(key), mapWord: () => null, now: () => now });
    await coordinator.start();
    await Bun.sleep(1);
    expect(navigation).toEqual(["1:1"]);
    expect(coordinator.getState().word).toBeUndefined();
    now += 1_000;
    await coordinator.stop();
  });
});
