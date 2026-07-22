import { afterEach, describe, expect, test } from "bun:test";
import {
  ayahImageUrl,
  clearAyahImageCache,
  fetchAyahImage,
} from "../../src/tui/utils/ayah-image.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearAyahImageCache();
});

describe("ayah image loading", () => {
  test("uses the canonical source URL and caches successful responses", async () => {
    let requests = 0;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    globalThis.fetch = (async (input) => {
      requests++;
      expect(String(input)).toBe("https://cdn.islamic.network/quran/images/high-resolution/2_255.png");
      return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
    }) as typeof fetch;

    const first = await fetchAyahImage(2, 255);
    const second = await fetchAyahImage(2, 255);

    expect(ayahImageUrl(2, 255)).toBe("https://cdn.islamic.network/quran/images/high-resolution/2_255.png");
    expect([...first]).toEqual([...png]);
    expect(second).toBe(first);
    expect(requests).toBe(1);
  });

  test("aborts requests that exceed the timeout", async () => {
    globalThis.fetch = ((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })) as typeof fetch;

    await expect(fetchAyahImage(1, 1, { timeoutMs: 1 })).rejects.toThrow("Image request timed out");
  });
});
