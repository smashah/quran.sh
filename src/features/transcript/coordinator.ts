export interface TranscriptVerse {
  readonly verseKey: string;
  readonly arabic: string;
  readonly translation?: string;
  readonly transliteration?: string;
  readonly attribution?: string;
}

export type TranscriptEntry =
  | { readonly kind: "verse"; readonly verse: TranscriptVerse }
  | { readonly kind: "revisit"; readonly verseKey: string };

export interface ReadingTranscript {
  commit(verse: TranscriptVerse): TranscriptEntry | null;
  entries(): readonly TranscriptEntry[];
}

export function createReadingTranscript(): ReadingTranscript {
  const committed = new Set<string>();
  const log: TranscriptEntry[] = [];
  let current: string | null = null;

  return {
    commit(verse) {
      if (current === verse.verseKey) return null;
      current = verse.verseKey;
      const entry: TranscriptEntry = committed.has(verse.verseKey)
        ? { kind: "revisit", verseKey: verse.verseKey }
        : { kind: "verse", verse };
      committed.add(verse.verseKey);
      log.push(entry);
      return entry;
    },
    entries: () => log,
  };
}

export function formatTranscriptEntry(entry: TranscriptEntry): string {
  if (entry.kind === "revisit") return `↩ ${entry.verseKey} revisited`;
  const lines = [`${entry.verse.arabic}  ﴿${entry.verse.verseKey}﴾`];
  if (entry.verse.translation) lines.push(entry.verse.translation);
  if (entry.verse.transliteration) lines.push(entry.verse.transliteration);
  if (entry.verse.attribution) lines.push(`— ${entry.verse.attribution}`);
  return lines.join("\n");
}
