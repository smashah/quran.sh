import { parseVerseKey } from "../../domain/quran-coordinate.ts";
import { readBoundedResponse } from "../network/bounded-response.ts";
import type { ResourceRow } from "../resources/repository.ts";
import type { StudySnapshot } from "./service.ts";

export const OPEN_STUDY_PROVIDER = {
  name: "Al Quran Cloud / Islamic Network",
  origin: "https://api.alquran.cloud",
  edition: "ar.muyassar",
  editionName: "Tafsir al-Muyassar",
  termsUrl: "https://alquran.cloud/terms-and-conditions",
} as const;

const REQUEST_LIMIT_BYTES = 256 * 1024;
const CACHE_LIMIT_ITEMS = 24;
const CACHE_LIMIT_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const cache = new Map<string, { readonly snapshot: StudySnapshot; readonly bytes: number }>();
let cacheBytes = 0;

function remember(verseKey: string, snapshot: StudySnapshot, bytes: number): void {
  const previous = cache.get(verseKey);
  if (previous) cacheBytes -= previous.bytes;
  cache.delete(verseKey);
  cache.set(verseKey, { snapshot, bytes });
  cacheBytes += bytes;
  while (cache.size > CACHE_LIMIT_ITEMS || cacheBytes > CACHE_LIMIT_BYTES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cacheBytes -= cache.get(oldest)?.bytes ?? 0;
    cache.delete(oldest);
  }
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<{ readonly value: unknown; readonly bytes: number }> {
  const body = await readBoundedResponse(response, {
    maxBytes: REQUEST_LIMIT_BYTES,
    signal,
    label: "The online study response",
  });
  try {
    return { value: JSON.parse(body.toString("utf8")), bytes: body.byteLength };
  } catch (cause) {
    throw new Error("The online study provider returned invalid JSON", { cause });
  }
}

function snapshotFromResponse(value: unknown, verseKey: string): StudySnapshot {
  const coordinate = parseVerseKey(verseKey);
  if (!coordinate || !value || typeof value !== "object") throw new Error("Invalid Quran coordinate");
  const envelope = value as { code?: unknown; data?: unknown };
  if (envelope.code !== 200 || !envelope.data || typeof envelope.data !== "object") {
    throw new Error("The online study provider did not return this ayah");
  }
  const data = envelope.data as Record<string, unknown>;
  const edition = data.edition as Record<string, unknown> | undefined;
  const surah = data.surah as Record<string, unknown> | undefined;
  if (typeof data.text !== "string" || !data.text.trim()
    || edition?.identifier !== OPEN_STUDY_PROVIDER.edition
    || surah?.number !== coordinate.surah
    || data.numberInSurah !== coordinate.ayah) {
    throw new Error("The online study response did not match the requested ayah and edition");
  }
  if (/[<>]/.test(data.text) || /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/i.test(data.text)) {
    throw new Error("The online study response contained unsupported markup");
  }
  const sourceUrl = `${OPEN_STUDY_PROVIDER.origin}/v1/ayah/${verseKey}/${OPEN_STUDY_PROVIDER.edition}`;
  const tafsir: ResourceRow = {
    verseKey,
    text: data.text,
    language: "ar",
    direction: "rtl",
    provenance: {
      packId: `online.${OPEN_STUDY_PROVIDER.edition}`,
      version: "live",
      provider: OPEN_STUDY_PROVIDER.name,
      sourceUrl,
      license: "Al Quran Cloud Terms",
      attribution: `${OPEN_STUDY_PROVIDER.editionName} via ${OPEN_STUDY_PROVIDER.name}`,
    },
    raw: {
      edition: OPEN_STUDY_PROVIDER.edition,
      editionName: OPEN_STUDY_PROVIDER.editionName,
      page: data.page,
      juz: data.juz,
      hizbQuarter: data.hizbQuarter,
      ruku: data.ruku,
      sajda: data.sajda,
      termsUrl: OPEN_STUDY_PROVIDER.termsUrl,
    },
  };
  return {
    verseKey,
    translation: [],
    tafsir: [tafsir],
    words: [],
    topics: [],
    crossReferences: [],
    mushaf: [],
    recitation: [],
  };
}

export async function fetchOpenStudySnapshot(
  verseKey: string,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<StudySnapshot> {
  if (!parseVerseKey(verseKey)) throw new Error(`Invalid verse key: ${verseKey}`);
  const cached = cache.get(verseKey);
  if (cached) {
    remember(verseKey, cached.snapshot, cached.bytes);
    return cached.snapshot;
  }
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Online study request timed out")), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const url = `${OPEN_STUDY_PROVIDER.origin}/v1/ayah/${verseKey}/${OPEN_STUDY_PROVIDER.edition}`;
  try {
    if (options.signal?.aborted) forwardAbort();
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      redirect: "error",
    });
    const finalUrl = new URL(response.url || url);
    if (finalUrl.protocol !== "https:" || finalUrl.origin !== OPEN_STUDY_PROVIDER.origin) {
      await response.body?.cancel().catch(() => {});
      throw new Error("The online study provider redirected outside its approved HTTPS origin");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`Online study request failed with HTTP ${response.status}`);
    }
    const { value, bytes } = await readBoundedJson(response, controller.signal);
    const snapshot = snapshotFromResponse(value, verseKey);
    remember(verseKey, snapshot, bytes);
    return snapshot;
  } catch (cause) {
    if (options.signal?.aborted) throw new Error("Online study request cancelled", { cause: options.signal.reason });
    if (controller.signal.aborted) throw new Error("Online study request timed out", { cause });
    throw cause;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

export function clearOpenStudyCache(): void {
  cache.clear();
  cacheBytes = 0;
}
