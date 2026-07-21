import { describe, expect, test } from "bun:test";
import { createRecitationPlayer, type PlaybackBackend, type PlaybackHandle } from "../../src/features/audio/player.ts";

describe("recitation player", () => {
  test("owns one stream and cancels it exactly once", async () => {
    let disposals = 0;
    let close!: () => void;
    const closed = new Promise<void>((resolve) => { close = resolve; });
    const handle: PlaybackHandle = {
      stats: () => ({ state: "playing", sampleRate: 48_000, framesPlayed: 48_000n, bufferedDurationMs: 500 }),
      setVolume: () => {},
      dispose: () => { disposals++; close(); },
      closed,
    };
    const backend: PlaybackBackend = { play: async () => handle, dispose: () => {} };
    const player = createRecitationPlayer(backend, 1);
    await player.play("1:1", "fixture.mp3");
    await Bun.sleep(3);
    expect(player.getState()).toMatchObject({ status: "playing", verseKey: "1:1", elapsedMs: 1_000 });
    player.stop();
    expect(disposals).toBe(1);
    expect(player.getState()).toEqual({ status: "idle" });
  });

  test("a later play disposes the previous stream", async () => {
    let disposals = 0;
    const backend: PlaybackBackend = {
      play: async () => ({ stats: () => ({ state: "playing", sampleRate: 1, framesPlayed: 0n, bufferedDurationMs: 0 }), setVolume: () => {}, dispose: () => { disposals++; }, closed: new Promise(() => {}) }),
      dispose: () => {},
    };
    const player = createRecitationPlayer(backend);
    await player.play("1:1", "one.mp3");
    await player.play("1:2", "two.mp3");
    expect(disposals).toBe(1);
    player.dispose();
  });

  test("stopping while the backend is still opening cannot retain the late stream", async () => {
    let resolve!: (handle: PlaybackHandle) => void;
    let disposals = 0;
    const opening = new Promise<PlaybackHandle>((done) => { resolve = done; });
    const backend: PlaybackBackend = { play: async () => opening, dispose() {} };
    const player = createRecitationPlayer(backend);
    const playing = player.play("1:1", "slow.mp3");
    player.stop();
    resolve({ stats: () => ({ state: "playing", sampleRate: 1, framesPlayed: 0n, bufferedDurationMs: 0 }), setVolume() {}, dispose() { disposals++; }, closed: new Promise(() => {}) });
    await playing;
    expect(disposals).toBe(1);
    expect(player.getState()).toEqual({ status: "idle" });
  });
});
