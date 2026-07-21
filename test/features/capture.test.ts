import { describe, expect, test } from "bun:test";
import { decodePcm16Wav, resampleMono } from "../../src/features/capture/audio-capture.ts";

function wav(samples: readonly number[], sampleRate = 8_000): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  ascii(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); ascii(8, "WAVE"); ascii(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return bytes;
}

describe("audio capture contract", () => {
  test("decodes PCM WAV and normalizes to 16kHz mono", () => {
    const decoded = decodePcm16Wav(wav([0, 16384, -16384, 0]));
    expect(decoded.sampleRate).toBe(8_000);
    expect(decoded.samples[1]).toBeCloseTo(0.5);
    expect(resampleMono(decoded.samples, 8_000)).toHaveLength(8);
  });

  test("rejects encoded or malformed input", () => {
    expect(() => decodePcm16Wav(new Uint8Array(44))).toThrow("Not a RIFF/WAVE file");
  });
});
