import type { WordKey } from "../../domain/quran-coordinate.ts";
import { activeTimedWord, validateWordTimings, type WordTiming } from "../resources/timing.ts";
import type { RecitationPlayer } from "./player.ts";

export interface TimedRecitationState {
  readonly verseKey: string | null;
  readonly wordKey: WordKey | null;
  readonly status: "idle" | "ayah-only" | "word";
}

export interface TimedRecitationSession {
  getState(): TimedRecitationState;
  subscribe(listener: (state: TimedRecitationState) => void): () => void;
  dispose(): void;
}

export function createTimedRecitationSession(
  player: RecitationPlayer,
  timingsFor: (verseKey: string) => readonly WordTiming[] | null,
  options: { updateIntervalMs?: number; now?: () => number } = {},
): TimedRecitationSession {
  let state: TimedRecitationState = { verseKey: null, wordKey: null, status: "idle" };
  let lastPublishedAt = -Infinity;
  const listeners = new Set<(state: TimedRecitationState) => void>();
  const now = options.now ?? Date.now;
  const publish = (next: TimedRecitationState) => {
    state = next;
    for (const listener of listeners) listener(next);
  };
  const unsubscribe = player.subscribe((playback) => {
    if (playback.status === "idle" || playback.status === "ended" || playback.status === "error") {
      publish({ verseKey: "verseKey" in playback ? playback.verseKey ?? null : null, wordKey: null, status: "idle" });
      return;
    }
    if (playback.status !== "playing") return;
    if (now() - lastPublishedAt < (options.updateIntervalMs ?? 80)) return;
    lastPublishedAt = now();
    const timings = timingsFor(playback.verseKey);
    if (!timings || !validateWordTimings(timings).ok) {
      publish({ verseKey: playback.verseKey, wordKey: null, status: "ayah-only" });
      return;
    }
    const wordKey = activeTimedWord(timings, playback.elapsedMs);
    publish({ verseKey: playback.verseKey, wordKey, status: wordKey ? "word" : "ayah-only" });
  });
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { unsubscribe(); listeners.clear(); state = { verseKey: null, wordKey: null, status: "idle" }; },
  };
}
