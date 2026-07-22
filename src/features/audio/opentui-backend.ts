import { Audio, type AudioStream } from "@opentui/core";
import { readBoundedResponse } from "../network/bounded-response.ts";
import type { PlaybackBackend, PlaybackHandle } from "./player.ts";

const MAX_PRELOAD_BYTES = 4 * 1024 * 1024;

async function readBoundedAudio(response: Response, requestedUrl: string, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Audio preload failed with HTTP ${response.status}`);
  }
  const requested = new URL(requestedUrl);
  const received = new URL(response.url || requestedUrl);
  if (received.protocol !== "https:" || received.origin !== requested.origin) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Audio preload left its approved HTTPS origin");
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLocaleLowerCase();
  if (contentType && !["audio/mpeg", "audio/mp3", "application/octet-stream", "application/mp3"].includes(contentType)) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Audio preload returned ${contentType} instead of MP3 data`);
  }
  const bytes = await readBoundedResponse(response, {
    maxBytes: MAX_PRELOAD_BYTES,
    signal,
    label: "The audio preload",
  });
  if (bytes.byteLength === 0) throw new Error("Audio preload returned an empty MP3 body");
  return bytes;
}

export function createOpenTuiPlaybackBackend(): PlaybackBackend {
  const audio = Audio.create({ autoStart: true });
  let cached: { readonly url: string; readonly bytes: Uint8Array } | null = null;
  let pending: { readonly url: string; readonly promise: Promise<void> } | null = null;
  const streamOptions = {
    buffer: { capacityMs: 2_000, startupMs: 250, resumeMs: 500 },
  } as const;
  return {
    async play(url, signal): Promise<PlaybackHandle> {
      if (pending?.url === url) await pending.promise.catch(() => undefined);
      signal.throwIfAborted();
      const preloaded = cached?.url === url ? cached.bytes : null;
      if (preloaded) cached = null;
      const stream: AudioStream = preloaded
        ? await audio.playStream((async function* () { yield preloaded; })(), { signal, format: "mp3", ...streamOptions })
        : await audio.playStreamUrl(url, {
            signal,
            ...streamOptions,
            reconnect: { maxRetries: 2, initialDelayMs: 250, maxDelayMs: 1_000 },
          });
      return {
        stats: () => stream.getStats(),
        setVolume: (volume) => { stream.setVolume(volume); },
        dispose: () => stream.dispose(),
        closed: stream.closed,
      };
    },
    async preload(url, signal) {
      if (cached?.url === url) return;
      if (pending?.url === url) return pending.promise;
      cached = null;
      const promise = fetch(url, { signal, redirect: "error" }).then((response) => readBoundedAudio(response, url, signal)).then((bytes) => {
        signal.throwIfAborted();
        cached = { url, bytes };
      });
      pending = { url, promise };
      try { await promise; }
      finally { if (pending?.promise === promise) pending = null; }
    },
    clearPreload() { cached = null; pending = null; },
    dispose: () => { cached = null; pending = null; audio.dispose(); },
  };
}
