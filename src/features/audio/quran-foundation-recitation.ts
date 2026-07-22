import { parseVerseKey } from "../../domain/quran-coordinate.ts";
import { fetchQuranFoundationJson } from "../quran-foundation/client.ts";
import type { ResourceRow } from "../resources/repository.ts";
import { wordTimingsFromSegments } from "../resources/timing.ts";

const AUDIO_ORIGIN = "https://verses.quran.foundation";
const RESPONSE_LIMIT_BYTES = 256 * 1024;
const CACHE_LIMIT = 24;

export const QURAN_FOUNDATION_ALAFASY_RECITATION_ID = 7;
export const QURAN_FOUNDATION_TIMING_PERMISSION_KEY = "quranFoundationTimedRecitationAccepted";

const cache = new Map<string, ResourceRow>();

function segmentsFrom(value: unknown): readonly [number, number, number][] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 300) return [];
  const segments: [number, number, number][] = [];
  for (const [index, segment] of value.entries()) {
    if (!Array.isArray(segment) || segment.length < 3) return [];
    const [word, startMs, endMs] = segment;
    if (![word, startMs, endMs].every((part) => typeof part === "number" && Number.isFinite(part))) return [];
    if (!Number.isSafeInteger(word) || word !== index + 1 || startMs < 0 || endMs <= startMs) return [];
    segments.push([word, startMs, endMs]);
  }
  // This endpoint serves one file per ayah, so chapter-absolute timings must never
  // be combined with its zero-based player clock.
  return segments[0]?.[1] === 0 ? segments : [];
}

function absoluteAudioUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("The timed recitation response contained no audio URL");
  const url = URL.canParse(value) ? new URL(value) : new URL(value.replace(/^\/+/, ""), `${AUDIO_ORIGIN}/`);
  if (url.protocol !== "https:" || url.origin !== AUDIO_ORIGIN) {
    throw new Error("The timed recitation response used an unapproved audio origin");
  }
  return url.toString();
}

function rowFromResponse(value: unknown, verseKey: string): ResourceRow {
  if (!value || typeof value !== "object") throw new Error("The timed recitation provider returned an invalid response");
  const envelope = value as Record<string, unknown>;
  if (!Array.isArray(envelope.audio_files) || envelope.audio_files.length !== 1) {
    throw new Error("The timed recitation provider did not return exactly one ayah audio file");
  }
  const candidate = envelope.audio_files[0];
  if (!candidate || typeof candidate !== "object") throw new Error("The timed recitation provider returned an invalid audio record");
  const raw = candidate as Record<string, unknown>;
  const receivedKey = raw.verse_key ?? raw.verseKey;
  if (receivedKey !== verseKey) throw new Error("The timed recitation provider returned the wrong ayah");
  const segments = segmentsFrom(raw.segments);
  if (!wordTimingsFromSegments(verseKey, segments)) {
    throw new Error("The timed recitation provider returned invalid or missing word segments");
  }
  return {
    verseKey,
    audioUrl: absoluteAudioUrl(raw.url ?? raw.audio_url ?? raw.audioUrl),
    segments,
    provenance: {
      packId: `quran-foundation.recitation.${QURAN_FOUNDATION_ALAFASY_RECITATION_ID}`,
      version: "v4",
      provider: "Quran Foundation Content API",
      sourceUrl: "https://api-docs.quran.com/docs/content_apis_versioned/4.0.0/list-ayah-recitation/",
      license: "Quran Foundation developer terms; recitation rights remain with the reciter/provider",
      attribution: "Recitation by Mishari Rashid al-`Afasy · timing metadata from Quran Foundation",
      compatibility: { narration: "hafs", timingSchema: "ayah-word-ms-v1", recitationId: String(QURAN_FOUNDATION_ALAFASY_RECITATION_ID) },
    },
    raw: {
      id: raw.id,
      duration: raw.duration,
      format: raw.format,
      recitation_id: QURAN_FOUNDATION_ALAFASY_RECITATION_ID,
    },
  };
}

function remember(verseKey: string, row: ResourceRow): void {
  cache.delete(verseKey);
  cache.set(verseKey, row);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export async function fetchQuranFoundationTimedRecitation(
  verseKey: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ResourceRow> {
  if (!parseVerseKey(verseKey)) throw new Error(`Invalid verse key: ${verseKey}`);
  const cached = cache.get(verseKey);
  if (cached) { remember(verseKey, cached); return cached; }
  const fields = "chapter_id,verse_number,verse_key,format,url,segments,duration,id";
  const { value } = await fetchQuranFoundationJson(
    `/content/api/v4/recitations/${QURAN_FOUNDATION_ALAFASY_RECITATION_ID}/by_ayah/${encodeURIComponent(verseKey)}?fields=${encodeURIComponent(fields)}&per_page=1`,
    { signal: options.signal, maxBytes: RESPONSE_LIMIT_BYTES, label: "Quran Foundation timed recitation request" },
  );
  const row = rowFromResponse(value, verseKey);
  remember(verseKey, row);
  return row;
}

export function clearQuranFoundationTimedRecitationCache(): void {
  cache.clear();
}
