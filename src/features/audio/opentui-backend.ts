import { Audio, type AudioStream } from "@opentui/core";
import type { PlaybackBackend, PlaybackHandle } from "./player.ts";

export function createOpenTuiPlaybackBackend(): PlaybackBackend {
  const audio = Audio.create({ autoStart: true });
  return {
    async play(url, signal): Promise<PlaybackHandle> {
      const stream: AudioStream = await audio.playStreamUrl(url, {
        signal,
        buffer: { capacityMs: 2_000, startupMs: 250, resumeMs: 500 },
        reconnect: { maxRetries: 2, initialDelayMs: 250, maxDelayMs: 1_000 },
      });
      return {
        stats: () => stream.getStats(),
        setVolume: (volume) => { stream.setVolume(volume); },
        dispose: () => stream.dispose(),
        closed: stream.closed,
      };
    },
    dispose: () => audio.dispose(),
  };
}
