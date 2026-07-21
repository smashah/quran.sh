export interface PcmChunk {
  readonly samples: Float32Array;
  readonly sampleRate: 16_000;
  readonly capturedAt: number;
}

export interface AudioCaptureSession extends AsyncIterable<PcmChunk> {
  stop(): Promise<void>;
}

export interface AudioCapture {
  readonly name: string;
  available(): Promise<boolean>;
  start(signal?: AbortSignal): Promise<AudioCaptureSession>;
}

export function resampleMono(input: Float32Array, inputRate: number, outputRate = 16_000): Float32Array {
  if (inputRate === outputRate) return input.slice();
  if (inputRate <= 0 || outputRate <= 0) throw new Error("Sample rates must be positive");
  const length = Math.max(1, Math.floor(input.length * outputRate / inputRate));
  const output = new Float32Array(length);
  const ratio = inputRate / outputRate;
  for (let index = 0; index < length; index++) {
    const source = index * ratio;
    const left = Math.floor(source);
    const right = Math.min(input.length - 1, left + 1);
    const mix = source - left;
    output[index] = (input[left] ?? 0) * (1 - mix) + (input[right] ?? 0) * mix;
  }
  return output;
}

export function decodePcm16Wav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 44 || view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) throw new Error("Not a RIFF/WAVE file");
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataOffset = 0;
  let dataLength = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = view.getUint32(offset, false);
    const length = view.getUint32(offset + 4, true);
    if (id === 0x666d7420) {
      if (view.getUint16(offset + 8, true) !== 1) throw new Error("Only PCM WAV is supported");
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bits = view.getUint16(offset + 22, true);
    } else if (id === 0x64617461) {
      dataOffset = offset + 8;
      dataLength = length;
    }
    offset += 8 + length + (length & 1);
  }
  if (!channels || !sampleRate || bits !== 16 || !dataOffset) throw new Error("WAV must be 16-bit PCM");
  const frames = Math.floor(dataLength / 2 / channels);
  const mono = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) sum += view.getInt16(dataOffset + (frame * channels + channel) * 2, true) / 32768;
    mono[frame] = sum / channels;
  }
  return { samples: mono, sampleRate };
}
