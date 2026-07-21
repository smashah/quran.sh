export type RecitationPlayerState =
  | { readonly status: "idle" }
  | { readonly status: "buffering"; readonly verseKey: string }
  | { readonly status: "playing"; readonly verseKey: string; readonly elapsedMs: number; readonly bufferedMs: number }
  | { readonly status: "ended"; readonly verseKey: string }
  | { readonly status: "error"; readonly verseKey?: string; readonly message: string };

export interface PlaybackHandle {
  stats(): { state: string; sampleRate: number; framesPlayed: bigint; bufferedDurationMs: number };
  setVolume(volume: number): void;
  dispose(): void;
  readonly closed: Promise<void>;
}

export interface PlaybackBackend {
  play(url: string, signal: AbortSignal): Promise<PlaybackHandle>;
  dispose(): void;
}

export interface RecitationPlayer {
  play(verseKey: string, url: string): Promise<void>;
  stop(): void;
  setVolume(volume: number): void;
  getState(): RecitationPlayerState;
  subscribe(listener: (state: RecitationPlayerState) => void): () => void;
  dispose(): void;
}

export function createRecitationPlayer(backend: PlaybackBackend, pollMs = 100): RecitationPlayer {
  let state: RecitationPlayerState = { status: "idle" };
  let handle: PlaybackHandle | null = null;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let generation = 0;
  let volume = 1;
  const listeners = new Set<(state: RecitationPlayerState) => void>();

  const publish = (next: RecitationPlayerState) => {
    state = next;
    for (const listener of listeners) listener(next);
  };
  const stop = () => {
    generation++;
    controller?.abort();
    controller = null;
    handle?.dispose();
    handle = null;
    if (timer) clearInterval(timer);
    timer = null;
    publish({ status: "idle" });
  };

  return {
    async play(verseKey, url) {
      stop();
      const current = generation;
      const localController = new AbortController();
      controller = localController;
      publish({ status: "buffering", verseKey });
      try {
        const stream = await backend.play(url, localController.signal);
        if (current !== generation || localController.signal.aborted) {
          stream.dispose();
          return;
        }
        handle = stream;
        handle.setVolume(volume);
        timer = setInterval(() => {
          if (!handle || current !== generation) return;
          const stats = handle.stats();
          const elapsedMs = stats.sampleRate > 0 ? Number(stats.framesPlayed) / stats.sampleRate * 1000 : 0;
          publish({ status: stats.state === "playing" ? "playing" : "buffering", verseKey, elapsedMs, bufferedMs: stats.bufferedDurationMs });
        }, pollMs);
        void stream.closed.then(() => {
          if (current !== generation) return;
          if (timer) clearInterval(timer);
          timer = null;
          handle = null;
          publish({ status: "ended", verseKey });
        });
      } catch (cause) {
        if (current !== generation || localController.signal.aborted) return;
        publish({ status: "error", verseKey, message: cause instanceof Error ? cause.message : "Playback failed" });
      }
    },
    stop,
    setVolume(next) {
      volume = Math.max(0, Math.min(1, next));
      handle?.setVolume(volume);
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      stop();
      listeners.clear();
      backend.dispose();
    },
  };
}
