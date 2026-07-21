import type { VerseKey, WordKey } from "../../domain/quran-coordinate.ts";

export interface MushafWordPlacement {
  readonly wordKey: WordKey;
  readonly verseKey: VerseKey;
  readonly page: number;
  readonly line: number;
  readonly x: number;
  readonly text: string;
}

export interface MushafLineScene {
  readonly line: number;
  readonly words: readonly MushafWordPlacement[];
  readonly active: boolean;
  readonly completed: boolean;
}

export interface MushafPageScene {
  readonly page: number;
  readonly lines: readonly MushafLineScene[];
  readonly activeVerse: VerseKey;
}

export function buildMushafPageScene(
  placements: readonly MushafWordPlacement[],
  page: number,
  activeVerse: VerseKey,
): MushafPageScene {
  const pageWords = placements.filter((placement) => placement.page === page);
  const activeLine = pageWords.find((word) => word.verseKey === activeVerse)?.line ?? -1;
  const grouped = new Map<number, MushafWordPlacement[]>();
  for (const word of pageWords) grouped.set(word.line, [...(grouped.get(word.line) ?? []), word]);
  const lines = [...grouped.entries()].sort(([a], [b]) => a - b).map(([line, words]) => ({
    line,
    words: words.sort((a, b) => b.x - a.x),
    active: line === activeLine,
    completed: activeLine >= 0 && line < activeLine,
  }));
  return { page, lines, activeVerse };
}
