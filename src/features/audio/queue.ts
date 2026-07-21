import type { RecitationPlayer, RecitationPlayerState } from "./player.ts";

export interface RecitationTrack {
  readonly verseKey: string;
  readonly url: string;
  readonly reciter: string;
  readonly attribution: string;
}

export interface RecitationQueue {
  start(tracks: readonly RecitationTrack[], index?: number): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  stop(): void;
  current(): RecitationTrack | null;
  dispose(): void;
}

export function createRecitationQueue(player: RecitationPlayer): RecitationQueue {
  let tracks: readonly RecitationTrack[] = [];
  let index = -1;
  let generation = 0;
  const playCurrent = async (expectedGeneration: number) => {
    const track = tracks[index];
    if (!track || expectedGeneration !== generation) return;
    await player.play(track.verseKey, track.url);
  };
  const unsubscribe = player.subscribe((state: RecitationPlayerState) => {
    if (state.status !== "ended") return;
    const track = tracks[index];
    if (!track || track.verseKey !== state.verseKey || index >= tracks.length - 1) return;
    index++;
    void playCurrent(generation);
  });
  return {
    async start(nextTracks, nextIndex = 0) {
      generation++;
      tracks = nextTracks;
      index = Math.max(0, Math.min(nextTracks.length - 1, nextIndex));
      await playCurrent(generation);
    },
    async next() { if (index < tracks.length - 1) { generation++; index++; await playCurrent(generation); } },
    async previous() { if (index > 0) { generation++; index--; await playCurrent(generation); } },
    stop() { generation++; player.stop(); },
    current: () => tracks[index] ?? null,
    dispose() { generation++; unsubscribe(); player.dispose(); tracks = []; index = -1; },
  };
}
