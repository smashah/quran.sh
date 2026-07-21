import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installTilawaModel, verifyTilawaModel, type TilawaModelManifest } from "../../src/features/recognition/model-manager.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function manifest(bytes: Uint8Array, digest?: string): TilawaModelManifest {
  return {
    schemaVersion: 1,
    version: "fixture",
    source: "https://example.test/release",
    license: "fixture",
    attribution: "fixture attribution",
    files: [{
      name: "model.onnx",
      url: "https://example.test/model.onnx",
      bytes: bytes.byteLength,
      sha256: digest ?? new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    }],
  };
}

describe("Tilawa model lifecycle", () => {
  test("streams, verifies, and promotes a pinned model", async () => {
    const root = await mkdtemp(join(tmpdir(), "quran-model-"));
    const bytes = new Uint8Array([1, 2, 3, 4]);
    globalThis.fetch = (async () => new Response(bytes)) as unknown as typeof fetch;
    try {
      const directory = await installTilawaModel(root, manifest(bytes));
      expect(await verifyTilawaModel(directory)).toBe(true);
      expect([...await readFile(join(directory, "model.onnx"))]).toEqual([...bytes]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("a corrupt replacement leaves the verified version intact", async () => {
    const root = await mkdtemp(join(tmpdir(), "quran-model-"));
    const original = new Uint8Array([1, 2, 3]);
    globalThis.fetch = (async () => new Response(original)) as unknown as typeof fetch;
    try {
      const directory = await installTilawaModel(root, manifest(original));
      const corrupt = new Uint8Array([9, 9, 9]);
      globalThis.fetch = (async () => new Response(corrupt)) as unknown as typeof fetch;
      await expect(installTilawaModel(root, manifest(corrupt, "0".repeat(64)))).rejects.toThrow("Checksum mismatch");
      expect(await verifyTilawaModel(directory)).toBe(true);
      expect([...await readFile(join(directory, "model.onnx"))]).toEqual([...original]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
