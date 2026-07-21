import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionOutput, SessionRunner, TilawaAssets, WorkerOutbound } from "@tilawa/core";
import { makeVerseKey } from "../../domain/quran-coordinate.ts";
import type { RecognitionEvent, TilawaRecognizer } from "./types.ts";

interface OnnxTensor {
  readonly data: Float32Array;
  readonly dims: readonly number[];
}

interface OnnxSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, OnnxTensor>>;
  release(): Promise<void> | void;
}

interface OnnxModule {
  Tensor: new (type: string, data: Float32Array | BigInt64Array, dimensions: number[]) => unknown;
  InferenceSession: { create(path: string): Promise<OnnxSession> };
}

export interface TilawaAssetDirectory {
  readonly directory: string;
  readonly modelFile?: string;
}

function normalizedEvent(message: WorkerOutbound): RecognitionEvent[] {
  const verseKey = (surah: number, ayah: number) => {
    try { return makeVerseKey(surah, ayah); } catch { return null; }
  };
  if (message.type === "verse_match") {
    const key = verseKey(message.surah, message.ayah);
    return key ? [{ type: "match", verseKey: key, confidence: message.confidence }] : [{ type: "status", message: "Tilawa returned an invalid Quran coordinate; match ignored" }];
  }
  if (message.type === "verse_candidate") {
    const first = message.candidates[0];
    if (!first) return [];
    const key = verseKey(first.surah, first.ayah);
    return key ? [{ type: "candidate", verseKey: key, confidence: first.confidence, stable: message.stable }] : [];
  }
  if (message.type === "word_progress") {
    const key = verseKey(message.surah, message.ayah);
    if (!key) return [];
    // Tilawa's token index is source-token progress, not a verified quran.sh/QUL
    // word coordinate. The coordinator may highlight only after #25 alignment.
    return [{ type: "word-progress", verseKey: key, wordKey: null, sourceIndexes: message.matched_indices }];
  }
  if (message.type === "final_sequence") {
    const verses = message.verses.flatMap((verse) => {
      const key = verseKey(verse.surah, verse.ayah);
      return key ? [key] : [];
    });
    return [{ type: "final", verses, confidence: message.confidence }];
  }
  if (message.type === "loading_status" || message.type === "error") return [{ type: "status", message: message.message }];
  return [];
}

export async function createTilawaRecognizer(assets: TilawaAssetDirectory): Promise<TilawaRecognizer> {
  const packageName: string = "onnxruntime-node";
  let onnx: OnnxModule;
  try {
    onnx = await import(packageName) as unknown as OnnxModule;
  } catch (cause) {
    throw new Error("Tilawa requires the optional onnxruntime-node package on this platform", { cause });
  }
  const [{ createTilawaSession }, vocab, quranCtcTokens, quran] = await Promise.all([
    import("@tilawa/core"),
    readFile(join(assets.directory, "vocab.json"), "utf8").then(JSON.parse),
    readFile(join(assets.directory, "quran_ctc_tokens.json"), "utf8").then(JSON.parse),
    readFile(join(assets.directory, "quran.json"), "utf8").then(JSON.parse),
  ]);
  const session = await onnx.InferenceSession.create(join(assets.directory, assets.modelFile ?? "model.onnx"));
  const runner: SessionRunner = {
    async run(audio): Promise<SessionOutput> {
      const output = await session.run({
        audio_signal: new onnx.Tensor("float32", audio, [1, audio.length]),
        length: new onnx.Tensor("int64", BigInt64Array.of(BigInt(audio.length)), [1]),
      });
      const tensor = output.logprobs ?? Object.values(output)[0];
      if (!tensor || tensor.dims.length < 3) throw new Error("Tilawa model returned an unexpected output shape");
      return { logprobs: tensor.data, timeSteps: tensor.dims[1]!, vocabSize: tensor.dims[2]! };
    },
  };
  const tilawaAssets: TilawaAssets = { vocab, quranCtcTokens, quran };
  const outputQueue: RecognitionEvent[] = [];
  const tilawa = createTilawaSession(runner, tilawaAssets, {
    onOutput: (message) => {
      outputQueue.push(...normalizedEvent(message));
      if (outputQueue.length > 64) outputQueue.splice(0, outputQueue.length - 64);
    },
  });
  let serial = Promise.resolve<readonly RecognitionEvent[]>([]);
  let closed = false;
  let pendingFeeds = 0;
  return {
    feed(chunk) {
      if (closed) return Promise.reject(new Error("Tilawa recognizer is closed"));
      if (pendingFeeds >= 4) return Promise.reject(new Error("Tilawa PCM queue is full; input must apply backpressure"));
      pendingFeeds += 1;
      serial = serial.then(async () => {
        outputQueue.length = 0;
        const messages = await tilawa.feed(chunk);
        return messages.flatMap(normalizedEvent);
      }).finally(() => { pendingFeeds -= 1; });
      return serial;
    },
    reset: () => tilawa.reset(),
    async dispose() {
      if (closed) return;
      closed = true;
      await serial.catch(() => {});
      await session.release();
      outputQueue.length = 0;
    },
  };
}
