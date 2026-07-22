import type { VerseKey } from "../../domain/quran-coordinate.ts";

export type QuranScriptStyle = "uthmani" | "indopak" | "tajweed";
export type QuranReadingLayout = "ayah" | "page";

export interface QuranReadingLine {
  readonly id: string;
  readonly text: string;
  readonly active: boolean;
}

export interface QuranReadingSurface {
  readonly verseKey: VerseKey;
  readonly layout: QuranReadingLayout;
  readonly script: QuranScriptStyle;
  readonly lines: readonly QuranReadingLine[];
  readonly page?: number;
  readonly exactLineLayout: boolean;
}

export interface VisualBackdrop {
  readonly kind: "opentui-three";
  setVerse(verseKey: VerseKey, progress: number): void;
  setActiveWord(wordPosition: number | null): void;
  setMushafContext(context: { readonly page: number; readonly activeLine: number; readonly totalLines: number } | null): void;
  setReadingSurface(surface: QuranReadingSurface): Promise<void>;
  setVisible(visible: boolean): void;
  setReducedMotion(reduced: boolean): void;
  dispose(): void;
}

export interface VisualBackdropFactory {
  create(): Promise<VisualBackdrop>;
}
