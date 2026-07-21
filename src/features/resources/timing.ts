import { makeWordKey, parseVerseKey, type WordKey } from "../../domain/quran-coordinate.ts";

export interface WordTiming {
  readonly wordKey: WordKey;
  readonly startMs: number;
  readonly endMs: number;
}

export function activeTimedWord(timings: readonly WordTiming[], elapsedMs: number): WordKey | null {
  let low = 0;
  let high = timings.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const timing = timings[middle]!;
    if (elapsedMs < timing.startMs) high = middle - 1;
    else if (elapsedMs >= timing.endMs) low = middle + 1;
    else return timing.wordKey;
  }
  return null;
}

export function validateWordTimings(timings: readonly WordTiming[]): { ok: true } | { ok: false; reason: string } {
  let previousEnd = 0;
  for (const timing of timings) {
    if (!Number.isFinite(timing.startMs) || !Number.isFinite(timing.endMs) || timing.startMs < previousEnd || timing.endMs <= timing.startMs) {
      return { ok: false, reason: `Invalid or overlapping timing at ${timing.wordKey}` };
    }
    previousEnd = timing.endMs;
  }
  return { ok: true };
}

export function wordTimingsFromSegments(
  verseKey: string,
  segments: readonly (readonly [number, number, number])[],
): readonly WordTiming[] | null {
  const verse = parseVerseKey(verseKey);
  if (!verse || segments.length === 0) return null;
  const timings: WordTiming[] = [];
  for (const [word, startMs, endMs] of segments) {
    try { timings.push({ wordKey: makeWordKey(verse.surah, verse.ayah, word), startMs, endMs }); }
    catch { return null; }
  }
  timings.sort((a, b) => a.startMs - b.startMs);
  return validateWordTimings(timings).ok ? timings : null;
}
