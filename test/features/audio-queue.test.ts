import { describe, expect, test } from "bun:test";
import { createRecitationQueue } from "../../src/features/audio/queue.ts";
import { createTimedRecitationSession } from "../../src/features/audio/timed-session.ts";
import type { RecitationPlayer, RecitationPlayerState } from "../../src/features/audio/player.ts";

function fakePlayer() {
  let state: RecitationPlayerState = { status: "idle" };
  const listeners = new Set<(state: RecitationPlayerState) => void>();
  const plays: string[] = [];
  const player: RecitationPlayer = {
    async play(verseKey) { plays.push(verseKey); state = { status: "buffering", verseKey }; listeners.forEach((listener) => listener(state)); },
    stop() { state = { status: "idle" }; }, setVolume() {}, getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, dispose() {},
  };
  return { player, plays, emit: (next: RecitationPlayerState) => { state = next; listeners.forEach((listener) => listener(next)); } };
}

describe("continuous and timed recitation", () => {
  test("advances once only when the current generation ends", async () => {
    const fake = fakePlayer();
    const queue = createRecitationQueue(fake.player);
    await queue.start([
      { verseKey: "1:1", url: "1.mp3", reciter: "fixture", attribution: "fixture" },
      { verseKey: "1:2", url: "2.mp3", reciter: "fixture", attribution: "fixture" },
    ]);
    fake.emit({ status: "ended", verseKey: "9:9" });
    expect(fake.plays).toEqual(["1:1"]);
    fake.emit({ status: "ended", verseKey: "1:1" });
    await Bun.sleep(0);
    expect(fake.plays).toEqual(["1:1", "1:2"]);
    queue.dispose();
  });

  test("uses verified timing and falls back to ayah-only", () => {
    const fake = fakePlayer();
    let now = 1_000;
    const timed = createTimedRecitationSession(fake.player, (key) => key === "1:1" ? [
      { wordKey: "1:1:1", startMs: 0, endMs: 500 },
      { wordKey: "1:1:2", startMs: 500, endMs: 1_000 },
    ] : null, { now: () => now, updateIntervalMs: 50 });
    fake.emit({ status: "playing", verseKey: "1:1", elapsedMs: 750, bufferedMs: 100 });
    expect(timed.getState()).toEqual({ verseKey: "1:1", wordKey: "1:1:2", status: "word" });
    now += 100;
    fake.emit({ status: "playing", verseKey: "2:1", elapsedMs: 10, bufferedMs: 100 });
    expect(timed.getState()).toEqual({ verseKey: "2:1", wordKey: null, status: "ayah-only" });
    timed.dispose();
  });
});
