import { readFile } from "node:fs/promises";
import { decodePcm16Wav, resampleMono, type AudioCapture } from "./audio-capture.ts";

export function createWavCapture(path: string, chunkMs = 200): AudioCapture {
  return {
    name: "WAV file",
    available: async () => true,
    async start(signal) {
      const decoded = decodePcm16Wav(await readFile(path));
      const samples = resampleMono(decoded.samples, decoded.sampleRate);
      const chunkSize = Math.round(16_000 * chunkMs / 1_000);
      let stopped = false;
      return {
        async *[Symbol.asyncIterator]() {
          for (let offset = 0; offset < samples.length && !stopped; offset += chunkSize) {
            signal?.throwIfAborted();
            yield { samples: samples.slice(offset, offset + chunkSize), sampleRate: 16_000 as const, capturedAt: Date.now() };
          }
        },
        async stop() { stopped = true; },
      };
    },
  };
}
