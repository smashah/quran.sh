import { makeVerseKey } from "../../domain/quran-coordinate.ts";
import { readBoundedResponse } from "../../features/network/bounded-response.ts";

const IMAGE_CACHE_LIMIT = 24;
const IMAGE_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const imageCache = new Map<string, Buffer>();
let imageCacheBytes = 0;

export const AYAH_IMAGE_PROVIDER = "Al Quran Cloud / Islamic Network CDN";
export const AYAH_IMAGE_ORIGIN = "https://cdn.islamic.network";

export function ayahImageUrl(surahId: number, verseId: number): string {
  makeVerseKey(surahId, verseId);
  return `${AYAH_IMAGE_ORIGIN}/quran/images/high-resolution/${surahId}_${verseId}.png`;
}

function standardAyahImageUrl(surahId: number, verseId: number): string {
  return `${AYAH_IMAGE_ORIGIN}/quran/images/${surahId}_${verseId}.png`;
}

function remember(url: string, buffer: Buffer): void {
  const previous = imageCache.get(url);
  if (previous) imageCacheBytes -= previous.byteLength;
  imageCache.delete(url);
  imageCache.set(url, buffer);
  imageCacheBytes += buffer.byteLength;

  while (imageCache.size > IMAGE_CACHE_LIMIT || imageCacheBytes > IMAGE_CACHE_BYTES) {
    const oldest = imageCache.keys().next().value;
    if (!oldest) break;
    const removed = imageCache.get(oldest);
    if (removed) imageCacheBytes -= removed.byteLength;
    imageCache.delete(oldest);
  }
}

export async function fetchAyahImage(
  surahId: number,
  verseId: number,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Buffer> {
  const url = ayahImageUrl(surahId, verseId);
  const cached = imageCache.get(url);
  if (cached) {
    remember(url, cached);
    return cached;
  }

  const failures: string[] = [];
  for (const candidateUrl of [url, standardAyahImageUrl(surahId, verseId)]) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Image request timed out"));
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      if (options.signal?.aborted) abort();
      const response = await fetch(candidateUrl, { signal: controller.signal, redirect: "error" });
      const finalUrl = new URL(response.url || candidateUrl);
      if (finalUrl.protocol !== "https:" || finalUrl.origin !== AYAH_IMAGE_ORIGIN) {
        await response.body?.cancel().catch(() => {});
        throw new Error("Image source redirected outside the approved HTTPS origin");
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`Image request failed with HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "image/png") {
        await response.body?.cancel().catch(() => {});
        throw new Error(`Image source returned ${contentType || "an unknown content type"} instead of PNG`);
      }
      const buffer = await readBoundedResponse(response, {
        maxBytes: MAX_IMAGE_BYTES,
        signal: controller.signal,
        label: "The image response",
      });
      if (buffer.byteLength < PNG_SIGNATURE.byteLength
        || !buffer.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)) {
        throw new Error("Image source returned a body without a valid PNG signature");
      }
      remember(url, buffer);
      return buffer;
    } catch (cause) {
      if (options.signal?.aborted) throw new Error("Image request cancelled", { cause: options.signal.reason });
      failures.push(timedOut
        ? `Image request timed out for ${new URL(candidateUrl).pathname}`
        : cause instanceof Error ? cause.message : "unknown image-source failure");
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }
  throw new Error(`No image is available for this ayah from the approved provider: ${failures.join("; ")}`);
}

export function clearAyahImageCache(): void {
  imageCache.clear();
  imageCacheBytes = 0;
}

export function ayahImageCacheStats(): { items: number; bytes: number; byteLimit: number } {
  return { items: imageCache.size, bytes: imageCacheBytes, byteLimit: IMAGE_CACHE_BYTES };
}
