import { parseVerseKey } from "../../domain/quran-coordinate.ts";
import {
  clearQuranFoundationClient,
  fetchQuranFoundationJson,
  hasQuranFoundationCredentials as hasSharedQuranFoundationCredentials,
} from "../quran-foundation/client.ts";
import type { ResourceRow, ResourceTextBlock } from "../resources/repository.ts";
import type { StudySnapshot } from "./service.ts";

export const QURAN_FOUNDATION_TAFSIR_PROVIDER = {
  name: "Quran Foundation Content API",
  termsUrl: "https://api-docs.quran.com/legal/developer-terms/",
  resourcesDocsUrl: "https://api-docs.quran.com/docs/content_apis_versioned/4.0.0/tafsirs/",
  ayahDocsUrl: "https://api-docs.quran.com/docs/content_apis_versioned/4.0.0/list-ayah-tafsirs/",
} as const;

export const DEFAULT_TAFSIR_RESOURCE_ID = 169;

export interface TafsirResource {
  readonly id: number;
  readonly name: string;
  readonly authorName?: string;
  readonly slug: string;
  readonly languageName: string;
  readonly translatedName: string;
}

export type TafsirTextBlock = ResourceTextBlock;

const RESOURCE_RESPONSE_LIMIT_BYTES = 256 * 1024;
const TAFSIR_RESPONSE_LIMIT_BYTES = 1024 * 1024;
const TAFSIR_TEXT_LIMIT_CHARACTERS = 512 * 1024;
const MAX_RESOURCES = 256;
const MAX_VERSE_RANGE = 100;
const CACHE_LIMIT_ITEMS = 12;
const CACHE_LIMIT_BYTES = 4 * 1024 * 1024;
const UNSAFE_TERMINAL_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

let resourceCache: { readonly language: string; readonly resources: readonly TafsirResource[] } | null = null;
const tafsirCache = new Map<string, { readonly snapshot: StudySnapshot; readonly bytes: number }>();
let tafsirCacheBytes = 0;

export function hasQuranFoundationCredentials(): boolean {
  return hasSharedQuranFoundationCredentials();
}

function safeString(value: unknown, label: string, maximum = 512): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`The tafsir provider returned an invalid ${label}`);
  const text = value.trim();
  if (text.length > maximum || UNSAFE_TERMINAL_TEXT.test(text)) {
    throw new Error(`The tafsir provider returned an unsafe ${label}`);
  }
  return text;
}

function decodeEntity(entity: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: "&", apos: "'", gt: ">", hellip: "…", laquo: "«", ldquo: "“", lsquo: "‘",
    lt: "<", mdash: "—", nbsp: " ", ndash: "–", quot: "\"", raquo: "»", rdquo: "”", rsquo: "’",
  };
  const normalized = entity.toLocaleLowerCase("en");
  if (normalized.startsWith("#x")) {
    const codePoint = Number.parseInt(normalized.slice(2), 16);
    return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? String.fromCodePoint(codePoint)
      : "�";
  }
  if (normalized.startsWith("#")) {
    const codePoint = Number.parseInt(normalized.slice(1), 10);
    return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? String.fromCodePoint(codePoint)
      : "�";
  }
  return named[normalized] ?? `&${entity};`;
}

function directionFor(text: string, fallback: "rtl" | "ltr"): "rtl" | "ltr" {
  const arabic = text.match(/[\u0600-\u06ff]/gu)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (arabic === 0 && latin === 0) return fallback;
  return arabic > latin ? "rtl" : "ltr";
}

export function tafsirTextBlocksFromHtml(value: unknown, fallback: "rtl" | "ltr"): readonly TafsirTextBlock[] {
  if (typeof value !== "string" || !value.trim()) throw new Error("The tafsir provider returned no readable commentary");
  if (value.length > TAFSIR_TEXT_LIMIT_CHARACTERS) throw new Error("The tafsir commentary exceeded the terminal rendering limit");
  if (UNSAFE_TERMINAL_TEXT.test(value) || /<\/?(?:script|style|iframe|object|embed|svg|math)\b/i.test(value)) {
    throw new Error("The tafsir response contained unsafe markup");
  }
  const text = value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<sup(?:\s[^<>]*)?>/gi, " [")
    .replace(/<\/sup\s*>/gi, "] ")
    .replace(/<\/(?:p|div|blockquote|li|ul|ol|h[1-6]|section|article)\s*>/gi, "\n\n")
    .replace(/<li(?:\s[^<>]*)?>/gi, "- ")
    .replace(/<[^<>]+>/g, "")
    .replace(/&([#a-z0-9]+);/gi, (_, entity: string) => decodeEntity(entity))
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text || UNSAFE_TERMINAL_TEXT.test(text)) throw new Error("The tafsir response contained unsafe terminal text");
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  if (blocks.length === 0 || blocks.length > 1024) throw new Error("The tafsir response had an invalid paragraph structure");
  return blocks.map((block) => ({ text: block, direction: directionFor(block, fallback) }));
}

function resourcesFromResponse(value: unknown): readonly TafsirResource[] {
  if (!value || typeof value !== "object") throw new Error("The tafsir provider returned an invalid resource catalogue");
  const rawResources = (value as { tafsirs?: unknown }).tafsirs;
  if (!Array.isArray(rawResources) || rawResources.length > MAX_RESOURCES) {
    throw new Error("The tafsir provider returned an invalid resource catalogue");
  }
  const resources = rawResources.map((candidate): TafsirResource => {
    if (!candidate || typeof candidate !== "object") throw new Error("The tafsir provider returned an invalid resource");
    const raw = candidate as Record<string, unknown>;
    const translated = raw.translated_name && typeof raw.translated_name === "object"
      ? raw.translated_name as Record<string, unknown>
      : null;
    if (!Number.isSafeInteger(raw.id) || Number(raw.id) < 1) throw new Error("The tafsir provider returned an invalid resource ID");
    const name = safeString(raw.name, "resource name")!;
    return {
      id: Number(raw.id),
      name,
      authorName: safeString(raw.author_name, "author name"),
      slug: safeString(raw.slug, "resource slug") ?? "",
      languageName: safeString(raw.language_name, "resource language", 64)!,
      translatedName: safeString(translated?.name, "translated resource name") ?? name,
    };
  });
  return [...new Map(resources.map((resource) => [resource.id, resource])).values()];
}

function remember(key: string, snapshot: StudySnapshot, bytes: number): void {
  const previous = tafsirCache.get(key);
  if (previous) tafsirCacheBytes -= previous.bytes;
  tafsirCache.delete(key);
  tafsirCache.set(key, { snapshot, bytes });
  tafsirCacheBytes += bytes;
  while (tafsirCache.size > CACHE_LIMIT_ITEMS || tafsirCacheBytes > CACHE_LIMIT_BYTES) {
    const oldest = tafsirCache.keys().next().value;
    if (!oldest) break;
    tafsirCacheBytes -= tafsirCache.get(oldest)?.bytes ?? 0;
    tafsirCache.delete(oldest);
  }
}

function snapshotFromResponse(value: unknown, resource: TafsirResource, verseKey: string): StudySnapshot {
  if (!value || typeof value !== "object") throw new Error("The tafsir provider returned an invalid response");
  const tafsir = (value as { tafsir?: unknown }).tafsir;
  if (!tafsir || typeof tafsir !== "object") throw new Error("The tafsir provider did not return commentary");
  const raw = tafsir as Record<string, unknown>;
  if (raw.resource_id !== resource.id) throw new Error("The tafsir provider returned a different resource");
  const verses = raw.verses;
  if (!verses || typeof verses !== "object" || Array.isArray(verses)) throw new Error("The tafsir provider returned an invalid ayah range");
  const coordinates = Object.keys(verses as Record<string, unknown>).map((key) => parseVerseKey(key));
  if (coordinates.length === 0 || coordinates.length > MAX_VERSE_RANGE || coordinates.some((coordinate) => !coordinate)) {
    throw new Error("The tafsir provider returned commentary for a different ayah");
  }
  const sortedCoordinates = coordinates
    .filter((coordinate) => coordinate !== null)
    .sort((left, right) => left.surah - right.surah || left.ayah - right.ayah);
  const firstCoordinate = sortedCoordinates[0]!;
  const coveredVerseKeys = sortedCoordinates.map((coordinate) => coordinate.key);
  if (!coveredVerseKeys.some((key) => key === verseKey)
    || sortedCoordinates.some((coordinate) => coordinate.surah !== firstCoordinate.surah)
    || sortedCoordinates.some((coordinate, index) => index > 0 && coordinate.ayah !== sortedCoordinates[index - 1]!.ayah + 1)) {
    throw new Error("The tafsir provider returned a discontinuous ayah range");
  }
  const resourceName = safeString(raw.resource_name, "commentary name") ?? resource.translatedName;
  const fallbackDirection = resource.languageName.toLocaleLowerCase("en") === "arabic" ? "rtl" : "ltr";
  const blocks = tafsirTextBlocksFromHtml(raw.text, fallbackDirection);
  const row: ResourceRow = {
    verseKey,
    text: blocks.map((block) => block.text).join("\n\n"),
    language: resource.languageName,
    direction: fallbackDirection,
    contentBlocks: blocks,
    provenance: {
      packId: `online.quran-foundation.tafsir.${resource.id}`,
      version: "live",
      provider: QURAN_FOUNDATION_TAFSIR_PROVIDER.name,
      sourceUrl: QURAN_FOUNDATION_TAFSIR_PROVIDER.ayahDocsUrl,
      license: "Quran Foundation developer terms",
      attribution: `${resourceName}${resource.authorName ? ` · ${resource.authorName}` : ""} via Quran Foundation`,
    },
    raw: {
      resourceId: resource.id,
      resourceName,
      slug: safeString(raw.slug, "commentary slug") ?? resource.slug,
      termsUrl: QURAN_FOUNDATION_TAFSIR_PROVIDER.termsUrl,
      coveredVerseKeys,
    },
  };
  return {
    verseKey,
    translation: [],
    tafsir: [row],
    words: [],
    topics: [],
    crossReferences: [],
    mushaf: [],
    recitation: [],
  };
}

export async function fetchQuranFoundationTafsirResources(
  language = "en",
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<readonly TafsirResource[]> {
  if (!/^[a-z]{2,3}$/i.test(language)) throw new Error(`Invalid tafsir language: ${language}`);
  const normalizedLanguage = language.toLocaleLowerCase("en");
  if (resourceCache?.language === normalizedLanguage) return resourceCache.resources;
  const { value } = await fetchQuranFoundationJson(`/content/api/v4/resources/tafsirs?language=${normalizedLanguage}`, {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    maxBytes: RESOURCE_RESPONSE_LIMIT_BYTES,
    label: "Quran Foundation tafsir catalogue request",
  });
  const resources = resourcesFromResponse(value);
  resourceCache = { language: normalizedLanguage, resources };
  return resources;
}

export async function fetchQuranFoundationTafsirSnapshot(
  resource: TafsirResource,
  verseKey: string,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<StudySnapshot> {
  if (!parseVerseKey(verseKey)) throw new Error(`Invalid verse key: ${verseKey}`);
  const key = `${resource.id}:${verseKey}`;
  const cached = tafsirCache.get(key);
  if (cached) { remember(key, cached.snapshot, cached.bytes); return cached.snapshot; }
  const path = `/content/api/v4/tafsirs/${resource.id}/by_ayah/${encodeURIComponent(verseKey)}`;
  const { value, bytes } = await fetchQuranFoundationJson(path, {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    maxBytes: TAFSIR_RESPONSE_LIMIT_BYTES,
    label: "Quran Foundation tafsir request",
  });
  const snapshot = snapshotFromResponse(value, resource, verseKey);
  const retainedTextBytes = snapshot.tafsir.reduce((total, row) => total
    + (row.text?.length ?? 0) * 2
    + (row.contentBlocks?.reduce((blockTotal, block) => blockTotal + block.text.length * 2, 0) ?? 0), 0);
  remember(key, snapshot, bytes + retainedTextBytes);
  return snapshot;
}

export function clearQuranFoundationTafsirCache(): void {
  resourceCache = null;
  tafsirCache.clear();
  tafsirCacheBytes = 0;
  clearQuranFoundationClient();
}
