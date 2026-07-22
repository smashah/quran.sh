import { parseVerseKey } from "../../domain/quran-coordinate.ts";
import { getSurah } from "../../data/quran.ts";
import { readBoundedResponse } from "../network/bounded-response.ts";
import type { ResourceRow } from "../resources/repository.ts";
import { wordTimingsFromSegments } from "../resources/timing.ts";

const API_ORIGIN = "https://api.quran.com";
const AUDIO_ORIGIN = "https://verses.quran.com";
const RECITATION_ID = 7;
const RESPONSE_TIMEOUT_MS = 10_000;
const AYAH_RESPONSE_LIMIT_BYTES = 32 * 1024;
const CHAPTER_RESPONSE_LIMIT_BYTES = 512 * 1024;
const ROW_CACHE_LIMIT = 24;
const CHAPTER_CACHE_LIMIT = 2;

interface ChapterTiming {
  readonly verseKey: string;
  readonly timestampFrom: number;
  readonly timestampTo: number;
  readonly duration: number;
  readonly segments: readonly [number, number, number][];
}

const rowCache = new Map<string, ResourceRow>();
const chapterCache = new Map<number, ReadonlyMap<string, ChapterTiming>>();

async function fetchJson(
  path: string,
  options: { readonly signal?: AbortSignal; readonly maxBytes: number; readonly label: string },
): Promise<unknown> {
  const url = new URL(path, `${API_ORIGIN}/`);
  if (url.origin !== API_ORIGIN || !url.pathname.startsWith("/api/v4/")) throw new Error("Blocked an invalid Quran.com API path");
  const timeout = AbortSignal.timeout(RESPONSE_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const response = await fetch(url, { signal, redirect: "error", headers: { accept: "application/json" } });
    if (new URL(response.url || url).origin !== API_ORIGIN) {
      await response.body?.cancel().catch(() => {});
      throw new Error("The Quran.com API left its approved HTTPS origin");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`${options.label} failed with HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type")?.toLocaleLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`${options.label} returned an unexpected content type`);
    }
    const body = await readBoundedResponse(response, { maxBytes: options.maxBytes, signal, label: options.label });
    try { return JSON.parse(body.toString("utf8")); }
    catch (cause) { throw new Error(`${options.label} returned invalid JSON`, { cause }); }
  } catch (cause) {
    if (options.signal?.aborted) throw new Error(`${options.label} was cancelled`, { cause: options.signal.reason });
    if (timeout.aborted) throw new Error(`${options.label} timed out`, { cause });
    throw cause;
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizedSegments(value: unknown, timestampFrom: number): readonly [number, number, number][] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 300) return [];
  const absolute: [number, number, number][] = [];
  for (const segment of value) {
    if (!Array.isArray(segment)) return [];
    // Quran.com's chapter timing feed can interleave one-item repeat markers
    // and a two-item closing marker. Neither represents a timed word window.
    if (segment.length < 3 && segment.length > 0 && segment.every(Number.isSafeInteger)) continue;
    if (segment.length < 3) return [];
    const [word, absoluteStart, absoluteEnd] = segment;
    if (![word, absoluteStart, absoluteEnd].every((part) => typeof part === "number" && Number.isFinite(part))) return [];
    if (!Number.isSafeInteger(word) || word !== absolute.length + 1 || absoluteStart < 0 || absoluteEnd <= absoluteStart) return [];
    absolute.push([word, absoluteStart, absoluteEnd]);
  }
  const perAyahStart = absolute[0]?.[1];
  if (perAyahStart === undefined || Math.abs(perAyahStart - timestampFrom) > 2_000) return [];
  return absolute.map(([word, start, end]) => [word, start - perAyahStart, end - perAyahStart]);
}

function chapterTimingsFrom(value: unknown, chapter: number): ReadonlyMap<string, ChapterTiming> {
  if (!value || typeof value !== "object") throw new Error("Quran.com returned an invalid chapter-recitation response");
  const audioFile = (value as Record<string, unknown>).audio_file;
  if (!audioFile || typeof audioFile !== "object") throw new Error("Quran.com returned no chapter timing record");
  const rawRows = (audioFile as Record<string, unknown>).timestamps;
  if (!Array.isArray(rawRows) || rawRows.length === 0 || rawRows.length > 300) throw new Error("Quran.com returned no bounded chapter timings");
  const timings = new Map<string, ChapterTiming>();
  for (const rawRow of rawRows) {
    if (!rawRow || typeof rawRow !== "object") continue;
    const raw = rawRow as Record<string, unknown>;
    const verseKey = raw.verse_key;
    const coordinate = typeof verseKey === "string" ? parseVerseKey(verseKey) : null;
    const timestampFrom = finiteNumber(raw.timestamp_from);
    const timestampTo = finiteNumber(raw.timestamp_to);
    const duration = finiteNumber(raw.duration);
    if (typeof verseKey !== "string" || !coordinate || coordinate.surah !== chapter || timestampFrom === null || timestampTo === null || duration === null || timestampFrom < 0 || timestampTo <= timestampFrom) continue;
    const segments = normalizedSegments(raw.segments, timestampFrom);
    if (!wordTimingsFromSegments(verseKey, segments)) continue;
    timings.set(verseKey, { verseKey, timestampFrom, timestampTo, duration, segments });
  }
  if (timings.size === 0) throw new Error("Quran.com returned no valid word timing rows for this chapter");
  return timings;
}

function audioUrlFrom(value: unknown, verseKey: string): string {
  if (!value || typeof value !== "object") throw new Error("Quran.com returned an invalid ayah-recitation response");
  const rows = (value as Record<string, unknown>).audio_files;
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== "object") {
    throw new Error("Quran.com returned no unique ayah audio record");
  }
  const raw = rows[0] as Record<string, unknown>;
  if (raw.verse_key !== verseKey || typeof raw.url !== "string" || !raw.url.trim()) throw new Error("Quran.com returned the wrong ayah audio record");
  const url = URL.canParse(raw.url) ? new URL(raw.url) : new URL(raw.url.replace(/^\/+/, ""), `${AUDIO_ORIGIN}/`);
  if (url.protocol !== "https:" || url.origin !== AUDIO_ORIGIN) throw new Error("Quran.com returned an unapproved audio origin");
  return url.toString();
}

function rememberRow(verseKey: string, row: ResourceRow): void {
  rowCache.delete(verseKey);
  rowCache.set(verseKey, row);
  while (rowCache.size > ROW_CACHE_LIMIT) {
    const oldest = rowCache.keys().next().value;
    if (oldest === undefined) break;
    rowCache.delete(oldest);
  }
}

function rememberChapter(chapter: number, timings: ReadonlyMap<string, ChapterTiming>): void {
  chapterCache.delete(chapter);
  chapterCache.set(chapter, timings);
  while (chapterCache.size > CHAPTER_CACHE_LIMIT) {
    const oldest = chapterCache.keys().next().value;
    if (oldest === undefined) break;
    chapterCache.delete(oldest);
  }
}

export async function fetchQuranComTimedRecitation(
  verseKey: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ResourceRow> {
  const coordinate = parseVerseKey(verseKey);
  if (!coordinate) throw new Error(`Invalid verse key: ${verseKey}`);
  const cached = rowCache.get(verseKey);
  if (cached) { rememberRow(verseKey, cached); return cached; }

  let chapterTimings = chapterCache.get(coordinate.surah);
  let audioResponse: unknown;
  const fetchAudio = () => fetchJson(
    `/api/v4/recitations/${RECITATION_ID}/by_ayah/${encodeURIComponent(verseKey)}?per_page=1`,
    { signal: options.signal, maxBytes: AYAH_RESPONSE_LIMIT_BYTES, label: "Quran.com ayah recitation request" },
  );
  if (!chapterTimings) {
    const [audio, response] = await Promise.all([fetchAudio(), fetchJson(
      `/api/v4/chapter_recitations/${RECITATION_ID}/${coordinate.surah}?segments=true`,
      { signal: options.signal, maxBytes: CHAPTER_RESPONSE_LIMIT_BYTES, label: "Quran.com chapter timing request" },
    )]);
    audioResponse = audio;
    chapterTimings = chapterTimingsFrom(response, coordinate.surah);
    rememberChapter(coordinate.surah, chapterTimings);
  } else audioResponse = await fetchAudio();
  const timing = chapterTimings.get(verseKey);
  if (!timing) throw new Error(`Quran.com returned no word timing for ${verseKey}`);
  const verse = getSurah(coordinate.surah)?.verses[coordinate.ayah - 1];
  const expectedWords = verse?.text.trim().split(/\s+/u).filter(Boolean).length ?? 0;
  if (expectedWords === 0 || timing.segments.length !== expectedWords) {
    throw new Error(`Quran.com word timing does not match the bundled text for ${verseKey}`);
  }
  const audioUrl = audioUrlFrom(audioResponse, verseKey);
  const row: ResourceRow = {
    verseKey,
    audioUrl,
    segments: timing.segments,
    provenance: {
      packId: `quran-com.public-recitation.${RECITATION_ID}`,
      version: "v4",
      provider: "Quran.com public API",
      sourceUrl: `${API_ORIGIN}/api/v4/chapter_recitations/${RECITATION_ID}/${coordinate.surah}?segments=true`,
      license: "Quran.com terms; recitation rights remain with the reciter/provider",
      attribution: "Recitation by Mishari Rashid al-`Afasy · timing metadata from Quran.com",
      compatibility: { narration: "hafs", timingSchema: "ayah-word-ms-v1", recitationId: String(RECITATION_ID) },
    },
    raw: {
      duration: timing.duration,
      timestamp_from: timing.timestampFrom,
      timestamp_to: timing.timestampTo,
      recitation_id: RECITATION_ID,
    },
  };
  rememberRow(verseKey, row);
  return row;
}

export function clearQuranComTimedRecitationCache(): void {
  rowCache.clear();
  chapterCache.clear();
}
