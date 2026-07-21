import { describe, expect, test } from "bun:test";
import { createReadingTranscript, formatTranscriptEntry } from "../../src/features/transcript/coordinator.ts";

describe("reading transcript", () => {
  test("commits each verse once and marks explicit revisits", () => {
    const transcript = createReadingTranscript();
    const first = { verseKey: "1:1", arabic: "بِسْمِ", translation: "In the name" };
    expect(transcript.commit(first)?.kind).toBe("verse");
    expect(transcript.commit(first)).toBeNull();
    transcript.commit({ verseKey: "1:2", arabic: "الْحَمْدُ" });
    expect(transcript.commit(first)).toEqual({ kind: "revisit", verseKey: "1:1" });
    expect(transcript.entries()).toHaveLength(3);
  });

  test("produces copy-safe plain terminal text", () => {
    const entry = { kind: "verse", verse: { verseKey: "1:1", arabic: "بِسْمِ", translation: "In the name", attribution: "Sahih" } } as const;
    expect(formatTranscriptEntry(entry)).toBe("بِسْمِ  ﴿1:1﴾\nIn the name\n— Sahih");
  });
});
