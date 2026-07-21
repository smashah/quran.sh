import type { VerseKey, WordKey } from "../../domain/quran-coordinate.ts";

export type RecognitionEvent =
  | { readonly type: "candidate"; readonly verseKey: VerseKey; readonly confidence: number; readonly stable: boolean }
  | { readonly type: "match"; readonly verseKey: VerseKey; readonly confidence: number }
  | { readonly type: "word-progress"; readonly verseKey: VerseKey; readonly wordKey: WordKey | null; readonly sourceIndexes: readonly number[] }
  | { readonly type: "final"; readonly verses: readonly VerseKey[]; readonly confidence: number }
  | { readonly type: "status"; readonly message: string };

export interface TilawaRecognizer {
  feed(chunk: Float32Array): Promise<readonly RecognitionEvent[]>;
  reset(): void;
  dispose(): Promise<void>;
}
