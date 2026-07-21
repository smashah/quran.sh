import type { VerseKey } from "../../domain/quran-coordinate.ts";

export interface VisualBackdrop {
  readonly kind: "opentui-three";
  setVerse(verseKey: VerseKey, progress: number): void;
  setMushafContext(context: { readonly page: number; readonly activeLine: number; readonly totalLines: number } | null): void;
  setVisible(visible: boolean): void;
  setReducedMotion(reduced: boolean): void;
  dispose(): void;
}

export interface VisualBackdropFactory {
  create(): Promise<VisualBackdrop>;
}
