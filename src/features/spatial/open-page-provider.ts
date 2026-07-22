import { parseVerseKey, type VerseKey } from "../../domain/quran-coordinate.ts";
import { readBoundedResponse } from "../network/bounded-response.ts";

export const OPEN_PAGE_PROVIDER = {
  name: "Al Quran Cloud / Islamic Network",
  origin: "https://api.alquran.cloud",
  edition: "quran-uthmani",
  termsUrl: "https://alquran.cloud/terms-and-conditions",
} as const;

export interface OpenPageVerse {
  readonly verseKey: VerseKey;
  readonly text: string;
  readonly page: number;
}

export interface OpenQuranPage {
  readonly page: number;
  readonly verses: readonly OpenPageVerse[];
  readonly sourceUrl: string;
  readonly exactLineLayout: false;
}

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_CACHE_PAGES = 3;
const TIMEOUT_MS = 10_000;
const pageCache = new Map<number, OpenQuranPage>();

function remember(page: OpenQuranPage): void {
  pageCache.delete(page.page);
  pageCache.set(page.page, page);
  while (pageCache.size > MAX_CACHE_PAGES) {
    const oldest = pageCache.keys().next().value;
    if (oldest === undefined) break;
    pageCache.delete(oldest);
  }
}

async function request(path: string, signal: AbortSignal): Promise<unknown> {
  const url = `${OPEN_PAGE_PROVIDER.origin}${path}`;
  const response = await fetch(url, { signal, headers: { accept: "application/json" }, redirect: "error" });
  const finalUrl = new URL(response.url || url);
  if (finalUrl.protocol !== "https:" || finalUrl.origin !== OPEN_PAGE_PROVIDER.origin) {
    await response.body?.cancel().catch(() => {});
    throw new Error("The Quran page provider redirected outside its approved HTTPS origin");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Quran page request failed with HTTP ${response.status}`);
  }
  const bytes = await readBoundedResponse(response, { maxBytes: MAX_RESPONSE_BYTES, signal, label: "The Quran page response" });
  try { return JSON.parse(bytes.toString("utf8")); }
  catch (cause) { throw new Error("The Quran page provider returned invalid JSON", { cause }); }
}

function envelopeData(value: unknown): unknown {
  if (!value || typeof value !== "object") throw new Error("The Quran page provider returned an invalid response");
  const envelope = value as { code?: unknown; data?: unknown };
  if (envelope.code !== 200) throw new Error("The Quran page provider did not return the requested Quran text");
  return envelope.data;
}

function pageNumberFromAyah(value: unknown, requestedKey: VerseKey): number {
  const data = envelopeData(value);
  if (!data || typeof data !== "object") throw new Error("The Quran page provider returned an invalid ayah");
  const row = data as Record<string, unknown>;
  const surah = row.surah as Record<string, unknown> | undefined;
  const edition = row.edition as Record<string, unknown> | undefined;
  const coordinate = parseVerseKey(requestedKey)!;
  if (surah?.number !== coordinate.surah || row.numberInSurah !== coordinate.ayah || edition?.identifier !== OPEN_PAGE_PROVIDER.edition) {
    throw new Error("The Quran page provider returned a different ayah or edition");
  }
  if (!Number.isSafeInteger(row.page) || Number(row.page) < 1 || Number(row.page) > 604) {
    throw new Error("The Quran page provider returned an invalid Mushaf page number");
  }
  return Number(row.page);
}

function pageFromResponse(value: unknown, requestedPage: number): OpenQuranPage {
  const data = envelopeData(value);
  const pageData = data && typeof data === "object" ? data as Record<string, unknown> : null;
  const edition = pageData?.edition as Record<string, unknown> | undefined;
  const rows = Array.isArray(pageData?.ayahs) ? pageData.ayahs : [];
  if (rows.length === 0) throw new Error("The Quran page provider returned an empty page");
  if (pageData?.number !== requestedPage || edition?.identifier !== OPEN_PAGE_PROVIDER.edition) {
    throw new Error("The Quran page provider returned a different page or edition");
  }
  const verses = rows.map((entry): OpenPageVerse => {
    if (!entry || typeof entry !== "object") throw new Error("The Quran page provider returned an invalid page row");
    const row = entry as Record<string, unknown>;
    const surah = row.surah as Record<string, unknown> | undefined;
    const key = `${String(surah?.number)}:${String(row.numberInSurah)}`;
    if (!parseVerseKey(key) || row.page !== requestedPage || typeof row.text !== "string" || !row.text.trim()) {
      throw new Error("The Quran page provider returned mismatched Quran text");
    }
    if (/[<>]/.test(row.text)) throw new Error("The Quran page provider returned unsupported markup");
    return { verseKey: key as VerseKey, text: row.text, page: requestedPage };
  });
  return {
    page: requestedPage,
    verses,
    sourceUrl: `${OPEN_PAGE_PROVIDER.origin}/v1/page/${requestedPage}/${OPEN_PAGE_PROVIDER.edition}`,
    exactLineLayout: false,
  };
}

export async function fetchOpenQuranPage(
  verseKey: VerseKey,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<OpenQuranPage> {
  if (!parseVerseKey(verseKey)) throw new Error(`Invalid verse key: ${verseKey}`);
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Quran page request timed out")), options.timeoutMs ?? TIMEOUT_MS);
  try {
    if (options.signal?.aborted) forwardAbort();
    const pageNumber = pageNumberFromAyah(await request(`/v1/ayah/${verseKey}/${OPEN_PAGE_PROVIDER.edition}`, controller.signal), verseKey);
    const cached = pageCache.get(pageNumber);
    if (cached) { remember(cached); return cached; }
    const page = pageFromResponse(await request(`/v1/page/${pageNumber}/${OPEN_PAGE_PROVIDER.edition}`, controller.signal), pageNumber);
    if (!page.verses.some((verse) => verse.verseKey === verseKey)) throw new Error("The returned Quran page does not contain the requested ayah");
    remember(page);
    return page;
  } catch (cause) {
    if (options.signal?.aborted) throw new Error("Quran page request cancelled", { cause: options.signal.reason });
    if (controller.signal.aborted) throw new Error("Quran page request timed out", { cause });
    throw cause;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

export function clearOpenQuranPageCache(): void {
  pageCache.clear();
}
