import { parseVerseKey } from "../../domain/quran-coordinate.ts";
import {
  clearQuranFoundationClient,
  fetchQuranFoundationJson,
  hasQuranFoundationCredentials as hasSharedQuranFoundationCredentials,
} from "../quran-foundation/client.ts";
import type { HadithGrade, HadithPage, HadithRecord, HadithText } from "./types.ts";

export const QURAN_FOUNDATION_HADITH_PROVIDER = {
  name: "Quran Foundation Content API",
  authOrigin: "https://oauth2.quran.foundation",
  apiOrigin: "https://apis.quran.foundation",
  termsUrl: "https://api-docs.quran.com/legal/developer-terms/",
  docsUrl: "https://api-docs.quran.com/docs/content_apis_versioned/4.0.0/hadiths-by-ayah/",
} as const;

const RESPONSE_LIMIT_BYTES = 1024 * 1024;
const CACHE_LIMIT_ITEMS = 24;
const CACHE_LIMIT_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BODY_CHARACTERS = 256 * 1024;
const UNSAFE_TERMINAL_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const cache = new Map<string, { readonly value: HadithPage; readonly bytes: number }>();
let cacheBytes = 0;

export function hasQuranFoundationCredentials(): boolean {
  return hasSharedQuranFoundationCredentials();
}

function remember(key: string, value: HadithPage, bytes: number): void {
  const previous = cache.get(key);
  if (previous) cacheBytes -= previous.bytes;
  cache.delete(key);
  cache.set(key, { value, bytes });
  cacheBytes += bytes;
  while (cache.size > CACHE_LIMIT_ITEMS || cacheBytes > CACHE_LIMIT_BYTES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cacheBytes -= cache.get(oldest)?.bytes ?? 0;
    cache.delete(oldest);
  }
}

function stringField(raw: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) {
      if (UNSAFE_TERMINAL_TEXT.test(value)) throw new Error("The hadith response contained unsafe terminal control characters");
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function plainTextBody(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (/<\/?(?:script|style|iframe|object|embed)\b/i.test(value)) {
    throw new Error("The hadith response contained unsafe markup");
  }
  const withoutMarkup = value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(<br\s*\/?>\s*){2,}/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|blockquote|li|ul|ol|h[1-6])\s*>/gi, "\n")
    .replace(/<li(?:\s[^<>]*)?>/gi, "- ")
    .replace(/<[^<>]+>/g, "")
    .replace(/\[\/?quran(?:\s[^\]]*)?\]/gi, "");
  const decoded = withoutMarkup
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replaceAll("\u200f", "")
    .trim();
  if (UNSAFE_TERMINAL_TEXT.test(decoded)) {
    throw new Error("The hadith response contained unsafe terminal control characters");
  }
  if (decoded.length > MAX_BODY_CHARACTERS) throw new Error("A hadith body exceeded the terminal rendering limit");
  return decoded;
}

function mergeLocalizedPages(english: HadithPage, arabic: HadithPage): HadithPage {
  const arabicByReference = new Map(arabic.records.map((record) => [`${record.collection}:${record.hadithNumber}`, record]));
  const seen = new Set<string>();
  const records: HadithRecord[] = english.records.map((record) => {
    const key = `${record.collection}:${record.hadithNumber}`;
    seen.add(key);
    const localized = arabicByReference.get(key);
    const texts = [...record.texts];
    for (const text of localized?.texts ?? []) {
      if (!texts.some((candidate) => candidate.language === text.language && candidate.urn === text.urn)) texts.push(text);
    }
    return { ...record, texts };
  });
  for (const record of arabic.records) {
    const key = `${record.collection}:${record.hadithNumber}`;
    if (!seen.has(key)) records.push(record);
  }
  return { ...english, records, hasMore: english.hasMore || arabic.hasMore };
}

function sunnahReference(value: string): string | null {
  const first = value.split(",")[0]?.trim().replace(/^(\d+)\s+([a-z])$/i, "$1$2") ?? "";
  return /^\d+[a-z]?$/i.test(first) ? first : null;
}

function gradesFrom(value: unknown): HadithGrade[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = candidate as Record<string, unknown>;
    const grade = stringField(raw, "grade");
    if (!grade) return [];
    return [{ grade, gradedBy: stringField(raw, "graded_by", "gradedBy", "grade_by", "gradeBy") }];
  });
}

function pageFromResponse(value: unknown, verseKey: string, expectedPage: number): HadithPage {
  if (!value || typeof value !== "object") throw new Error("The hadith provider returned an invalid response");
  const envelope = value as Record<string, unknown>;
  if (!Array.isArray(envelope.hadiths)) throw new Error("The hadith provider did not return a hadith list");
  if (envelope.hadiths.length > 5) throw new Error("The hadith provider exceeded its documented page limit");
  const records: HadithRecord[] = envelope.hadiths.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") throw new Error("The hadith provider returned an invalid record");
    const raw = candidate as Record<string, unknown>;
    const collection = stringField(raw, "collection");
    const hadithNumber = stringField(raw, "hadith_number", "hadithNumber");
    if (!collection || !hadithNumber || !Array.isArray(raw.hadith)) throw new Error("The hadith provider returned an incomplete record");
    const texts: HadithText[] = raw.hadith.flatMap((candidateText) => {
      if (!candidateText || typeof candidateText !== "object") return [];
      const text = candidateText as Record<string, unknown>;
      const languageValue = stringField(text, "lang");
      const language = languageValue === "ar" ? "ar" : languageValue === "en" ? "en" : null;
      const body = plainTextBody(text.body);
      if (!language || !body) return [];
      return [{
        urn: typeof text.urn === "number" ? text.urn : undefined,
        language,
        direction: language === "ar" ? "rtl" : "ltr",
        chapterNumber: stringField(text, "chapter_number", "chapterNumber"),
        chapterTitle: stringField(text, "chapter_title", "chapterTitle"),
        body,
        grades: gradesFrom(text.grades),
      }];
    });
    if (texts.length === 0) throw new Error("The hadith provider returned a record without readable Arabic or English text");
    const sourceReference = sunnahReference(hadithNumber);
    return {
      id: `${collection}:${hadithNumber}:${index}`,
      collection,
      name: stringField(raw, "name") ?? collection,
      bookNumber: stringField(raw, "book_number", "bookNumber"),
      chapterId: stringField(raw, "chapter_id", "chapterId"),
      hadithNumber,
      texts,
      provenance: {
        provider: QURAN_FOUNDATION_HADITH_PROVIDER.name,
        sourceUrl: sourceReference
          ? `https://sunnah.com/${encodeURIComponent(collection)}:${encodeURIComponent(sourceReference)}`
          : QURAN_FOUNDATION_HADITH_PROVIDER.docsUrl,
        termsUrl: QURAN_FOUNDATION_HADITH_PROVIDER.termsUrl,
        license: "Quran Foundation terms; hadith cited via Sunnah.com",
        attribution: `${stringField(raw, "name") ?? collection} ${hadithNumber} · curated by Quran.com`,
      },
    };
  });
  const page = Number(envelope.page);
  if (!Number.isSafeInteger(page) || page !== expectedPage) {
    throw new Error("The hadith provider returned an unexpected pagination coordinate");
  }
  return {
    verseKey,
    records,
    page,
    hasMore: envelope.has_more === true || envelope.hasMore === true,
    source: "quran-foundation",
  };
}

async function requestPage(verseKey: string, page: number, language: "ar" | "en", signal: AbortSignal): Promise<{ value: HadithPage; bytes: number }> {
  const path = `/content/api/v4/hadith_references/by_ayah/${encodeURIComponent(verseKey)}/hadiths?language=${language}&page=${page}&limit=4`;
  const { value, bytes } = await fetchQuranFoundationJson(path, {
    signal,
    maxBytes: RESPONSE_LIMIT_BYTES,
    label: "Quran Foundation hadith request",
  });
  return { value: pageFromResponse(value, verseKey, page), bytes };
}

export async function fetchQuranFoundationHadithPage(
  verseKey: string,
  page = 1,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<HadithPage> {
  if (!parseVerseKey(verseKey)) throw new Error(`Invalid verse key: ${verseKey}`);
  if (!Number.isSafeInteger(page) || page < 1) throw new Error(`Invalid hadith page: ${page}`);
  const key = `${verseKey}:${page}`;
  const cached = cache.get(key);
  if (cached) { remember(key, cached.value, cached.bytes); return cached.value; }
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Quran Foundation hadith request timed out")), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    if (options.signal?.aborted) forwardAbort();
    const english = await requestPage(verseKey, page, "en", controller.signal);
    const arabic = await requestPage(verseKey, page, "ar", controller.signal);
    const value = mergeLocalizedPages(english.value, arabic.value);
    remember(key, value, english.bytes + arabic.bytes);
    return value;
  } catch (cause) {
    if (options.signal?.aborted) throw new Error("Hadith request cancelled", { cause: options.signal.reason });
    if (controller.signal.aborted) throw new Error("Quran Foundation hadith request timed out", { cause });
    throw cause;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

export function clearQuranFoundationHadithCache(): void {
  cache.clear();
  cacheBytes = 0;
  clearQuranFoundationClient();
}
