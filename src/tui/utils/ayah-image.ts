const IMAGE_CACHE_LIMIT = 24;
const DEFAULT_TIMEOUT_MS = 10_000;
const imageCache = new Map<string, Buffer>();

export function ayahImageUrl(surahId: number, verseId: number): string {
  return `https://surahquran.com/img/ayah/${surahId}-${verseId}.png`;
}

function remember(url: string, buffer: Buffer): void {
  imageCache.delete(url);
  imageCache.set(url, buffer);

  if (imageCache.size > IMAGE_CACHE_LIMIT) {
    const oldest = imageCache.keys().next().value;
    if (oldest) imageCache.delete(oldest);
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

  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    if (options.signal?.aborted) abort();
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Image request failed with HTTP ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    remember(url, buffer);
    return buffer;
  } catch (error) {
    if (timedOut) throw new Error("Image request timed out");
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function clearAyahImageCache(): void {
  imageCache.clear();
}
