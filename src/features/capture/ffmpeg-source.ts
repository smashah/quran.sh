import { platform } from "node:os";
import type { AudioCapture, AudioCaptureSession, PcmChunk } from "./audio-capture.ts";

export interface FfmpegCaptureOptions {
  readonly executable?: string;
  readonly input?: string;
  readonly chunkMs?: number;
}

function inputArgs(input?: string): string[] {
  const os = platform();
  if (os === "darwin") return ["-f", "avfoundation", "-i", input ?? ":0"];
  if (os === "linux") return ["-f", "pulse", "-i", input ?? "default"];
  if (os === "win32") return ["-f", "dshow", "-i", input ?? "audio=default"];
  throw new Error(`Live microphone capture is not supported on ${os}`);
}

export function createFfmpegCapture(options: FfmpegCaptureOptions = {}): AudioCapture {
  const executable = options.executable ?? Bun.which("ffmpeg") ?? "ffmpeg";
  return {
    name: "FFmpeg microphone",
    available: async () => Bun.which(executable) !== null,
    async start(signal): Promise<AudioCaptureSession> {
      signal?.throwIfAborted();
      if (!Bun.which(executable)) throw new Error("FFmpeg is required for live microphone capture");
      const child = Bun.spawn([
        executable, "-nostdin", "-hide_banner", "-loglevel", "error",
        ...inputArgs(options.input), "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1",
      ], { stdout: "pipe", stderr: "pipe" });
      const reader = child.stdout.getReader();
      const chunkBytes = Math.round(16_000 * (options.chunkMs ?? 200) / 1_000) * 4;
      let remainder = new Uint8Array();
      let stopped = false;
      const stop = async () => {
        if (stopped) return;
        stopped = true;
        await reader.cancel().catch(() => {});
        child.kill("SIGTERM");
        await child.exited;
      };
      const abort = () => { void stop(); };
      signal?.addEventListener("abort", abort, { once: true });

      return {
        async *[Symbol.asyncIterator](): AsyncIterator<PcmChunk> {
          try {
            while (!stopped) {
              const next = await reader.read();
              if (next.done) break;
              const combined = new Uint8Array(remainder.length + next.value.length);
              combined.set(remainder);
              combined.set(next.value, remainder.length);
              let offset = 0;
              while (combined.length - offset >= chunkBytes) {
                const bytes = combined.slice(offset, offset + chunkBytes);
                yield {
                  samples: new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice(),
                  sampleRate: 16_000,
                  capturedAt: Date.now(),
                };
                offset += chunkBytes;
              }
              remainder = combined.slice(offset);
            }
            const exitCode = await child.exited;
            if (!stopped && exitCode !== 0) throw new Error(`FFmpeg capture exited ${exitCode}`);
          } finally {
            signal?.removeEventListener("abort", abort);
            await stop();
          }
        },
        stop,
      };
    },
  };
}
