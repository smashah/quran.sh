import type { SourceWordMapping, VerseKey, WordKey } from "../../domain/quran-coordinate.ts";
import type { AudioCapture, AudioCaptureSession } from "../capture/audio-capture.ts";
import type { RecognitionEvent, TilawaRecognizer } from "./types.ts";

export interface FollowState {
  readonly status: "idle" | "starting" | "listening" | "stopping" | "failed";
  readonly candidate?: VerseKey;
  readonly current?: VerseKey;
  readonly word?: WordKey;
  readonly confidence?: number;
  readonly level?: number;
  readonly error?: string;
  readonly finalSequence?: readonly VerseKey[];
  readonly wordMapping?: "verified" | "ambiguous" | "unavailable";
}

export interface FollowCoordinator {
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): FollowState;
  subscribe(listener: (state: FollowState) => void): () => void;
}

export function createFollowCoordinator(options: {
  capture: AudioCapture;
  recognizer: TilawaRecognizer;
  navigate(verseKey: VerseKey): void;
  mapWord?(verseKey: VerseKey, sourceIndexes: readonly number[]): SourceWordMapping | null;
  minimumConfidence?: number;
  navigationCooldownMs?: number;
  now?: () => number;
}): FollowCoordinator {
  let state: FollowState = { status: "idle" };
  let capture: AudioCaptureSession | null = null;
  let controller: AbortController | null = null;
  let run: Promise<void> | null = null;
  let lastNavigation = 0;
  let lastVerse: VerseKey | null = null;
  let generation = 0;
  const listeners = new Set<(state: FollowState) => void>();
  const now = options.now ?? Date.now;
  const publish = (patch: Partial<FollowState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  const handle = (event: RecognitionEvent) => {
    if (event.type === "candidate") {
      publish({ candidate: event.verseKey, confidence: event.confidence });
      return;
    }
    if (event.type === "match") {
      const minimum = options.minimumConfidence ?? 0.45;
      const cooldown = options.navigationCooldownMs ?? 700;
      if (event.confidence < minimum || (event.verseKey === lastVerse && now() - lastNavigation < cooldown)) return;
      lastVerse = event.verseKey;
      lastNavigation = now();
      options.navigate(event.verseKey);
      publish({ current: event.verseKey, candidate: undefined, confidence: event.confidence, word: undefined });
      return;
    }
    if (event.type === "word-progress") {
      if (event.wordKey && !options.mapWord) {
        publish({ word: event.wordKey, wordMapping: "verified" });
        return;
      }
      const mapping = options.mapWord?.(event.verseKey, event.sourceIndexes);
      if (mapping?.status === "mapped" && mapping.wordKeys.length === 1) {
        publish({ word: mapping.wordKeys[0], wordMapping: "verified" });
      } else {
        publish({ word: undefined, wordMapping: mapping ? "ambiguous" : "unavailable" });
      }
      return;
    }
    if (event.type === "final") publish({ finalSequence: event.verses });
  };

  const coordinator: FollowCoordinator = {
    async start() {
      if (run) return;
      const current = ++generation;
      const localController = new AbortController();
      controller = localController;
      publish({ status: "starting", error: undefined, finalSequence: undefined });
      try {
        const localCapture = await options.capture.start(localController.signal);
        if (current !== generation || localController.signal.aborted) {
          await localCapture.stop();
          return;
        }
        capture = localCapture;
        publish({ status: "listening" });
        run = (async () => {
          await Promise.resolve();
          try {
            for await (const chunk of localCapture) {
              const squareSum = chunk.samples.reduce((sum, sample) => sum + sample * sample, 0);
              publish({ level: Math.sqrt(squareSum / Math.max(1, chunk.samples.length)) });
              for (const event of await options.recognizer.feed(chunk.samples)) handle(event);
            }
          } catch (cause) {
            if (!localController.signal.aborted) publish({ status: "failed", error: cause instanceof Error ? cause.message : "Recognition failed" });
          } finally {
            if (current === generation) {
              try { await localCapture.stop(); }
              catch (cause) { publish({ status: "failed", error: cause instanceof Error ? cause.message : "Capture cleanup failed" }); }
              capture = null;
              controller = null;
              run = null;
              options.recognizer.reset();
              if (state.status !== "failed") {
                state = { ...state, status: "idle", level: undefined };
                for (const listener of listeners) listener(state);
              }
            }
          }
        })();
      } catch (cause) {
        publish({ status: "failed", error: cause instanceof Error ? cause.message : "Capture failed" });
        controller = null;
        throw cause;
      }
    },
    async stop() {
      if (state.status === "idle") return;
      generation += 1;
      publish({ status: "stopping" });
      const activeController = controller;
      const activeCapture = capture;
      const activeRun = run;
      activeController?.abort();
      let stopError: unknown;
      try {
        await activeCapture?.stop();
      } catch (cause) {
        stopError = cause;
      } finally {
        await activeRun?.catch(() => {});
        capture = null;
        controller = null;
        run = null;
        options.recognizer.reset();
        state = { status: "idle" };
        for (const listener of listeners) listener(state);
      }
      if (stopError) throw stopError;
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return coordinator;
}
