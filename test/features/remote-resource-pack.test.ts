import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadAndInstallResourcePack } from "../../src/features/resources/download.ts";
import type { ResourcePackManifestInput } from "../../src/features/resources/manager.ts";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function remoteFixture() {
  const content = `${JSON.stringify({ recitations: [{ verse_key: "1:1", audio_url: "https://audio.example/1.mp3" }] })}\n`;
  const manifest: ResourcePackManifestInput = {
    schemaVersion: 1,
    id: "public.test-audio",
    version: "v1",
    title: "Public audio fixture",
    kind: "recitation",
    format: "json",
    source: { provider: "Test", resourceId: "audio", url: "https://example.test/source", retrievedAt: "2026-07-21T00:00:00Z" },
    content: { bytes: Buffer.byteLength(content), sha256: new Bun.CryptoHasher("sha256").update(content).digest("hex") },
    license: { name: "Test", url: "https://example.test/license", attribution: "Test reciter", redistribution: "allowed" },
    compatibility: { narration: "hafs" },
  };
  const manifestContent = JSON.stringify(manifest);
  return {
    content,
    manifest,
    manifestContent,
    manifestSha256: new Bun.CryptoHasher("sha256").update(manifestContent).digest("hex"),
  };
}

function pinned(sample: ReturnType<typeof remoteFixture>) {
  return {
    expectedId: sample.manifest.id,
    expectedVersion: sample.manifest.version,
    expectedManifestSha256: sample.manifestSha256,
    expectedDataSha256: sample.manifest.content.sha256,
    expectedDataBytes: sample.manifest.content.bytes,
    expectedKind: sample.manifest.kind,
    expectedProvider: sample.manifest.source.provider,
    expectedSourceUrl: sample.manifest.source.url,
  };
}

describe("remote resource-pack acquisition", () => {
  test("streams, verifies, and atomically installs a named pack", async () => {
    const root = mkdtempSync(join(tmpdir(), "quran-remote-pack-test-"));
    temporaryDirectories.push(root);
    const sample = remoteFixture();
    const progress: number[] = [];
    const fetcher = async (input: string | URL | Request) => {
      const url = String(input);
      return url.endsWith("manifest.json")
        ? new Response(sample.manifestContent, { headers: { "content-length": String(sample.manifestContent.length) } })
        : new Response(sample.content, { headers: { "content-length": String(Buffer.byteLength(sample.content)) } });
    };
    const installed = await downloadAndInstallResourcePack({
      rootDirectory: join(root, "resources"),
      manifestUrl: "https://example.test/manifest.json",
      dataUrl: "https://example.test/data.json",
      ...pinned(sample),
      maxManifestBytes: 32_000,
      maxDataBytes: 32_000,
      fetch: fetcher as typeof fetch,
      onProgress: (received) => progress.push(received),
    });
    expect(installed.manifest.id).toBe(sample.manifest.id);
    expect(existsSync(installed.dataPath)).toBe(true);
    expect(progress.at(-1)).toBe(Buffer.byteLength(sample.content));
  });

  test("re-verifies an existing pack before trusting it", async () => {
    const root = mkdtempSync(join(tmpdir(), "quran-remote-pack-test-"));
    temporaryDirectories.push(root);
    const sample = remoteFixture();
    const fetcher = async (input: string | URL | Request) => String(input).endsWith("manifest.json")
      ? new Response(sample.manifestContent)
      : new Response(sample.content);
    const options = {
      rootDirectory: join(root, "resources"),
      manifestUrl: "https://example.test/manifest.json",
      dataUrl: "https://example.test/data.json",
      ...pinned(sample),
      maxManifestBytes: 32_000,
      maxDataBytes: 32_000,
      fetch: fetcher as typeof fetch,
    };
    const installed = await downloadAndInstallResourcePack(options);
    writeFileSync(installed.dataPath, sample.content.replace("1.mp3", "2.mp3"));
    let requests = 0;
    await expect(downloadAndInstallResourcePack({
      ...options,
      fetch: (async () => { requests += 1; return new Response(); }) as unknown as typeof fetch,
    })).rejects.toMatchObject({ code: "checksum_mismatch" });
    expect(requests).toBe(0);
  });

  test("rejects an oversized response before installation", async () => {
    const root = mkdtempSync(join(tmpdir(), "quran-remote-pack-test-"));
    temporaryDirectories.push(root);
    const sample = remoteFixture();
    const fetcher = async (input: string | URL | Request) => String(input).endsWith("manifest.json")
      ? new Response(sample.manifestContent)
      : new Response(sample.content, { headers: { "content-length": "999999" } });
    await expect(downloadAndInstallResourcePack({
      rootDirectory: join(root, "resources"),
      manifestUrl: "https://example.test/manifest.json",
      dataUrl: "https://example.test/data.json",
      ...pinned(sample),
      maxManifestBytes: 32_000,
      maxDataBytes: 100,
      fetch: fetcher as typeof fetch,
    })).rejects.toMatchObject({ code: "size_mismatch" });
    expect(existsSync(join(root, "resources", sample.manifest.id))).toBe(false);
  });

  test("rejects a replaced manifest even when its identity still matches", async () => {
    const root = mkdtempSync(join(tmpdir(), "quran-remote-pack-test-"));
    temporaryDirectories.push(root);
    const sample = remoteFixture();
    const replacement = JSON.stringify({ ...sample.manifest, title: "Replaced at the remote URL" });
    const fetcher = async (input: string | URL | Request) => String(input).endsWith("manifest.json")
      ? new Response(replacement)
      : new Response(sample.content);
    await expect(downloadAndInstallResourcePack({
      rootDirectory: join(root, "resources"),
      manifestUrl: "https://example.test/manifest.json",
      dataUrl: "https://example.test/data.json",
      ...pinned(sample),
      maxManifestBytes: 32_000,
      maxDataBytes: 32_000,
      fetch: fetcher as typeof fetch,
    })).rejects.toMatchObject({ code: "checksum_mismatch" });
  });

  test("rejects an HTTPS request that finishes on an insecure redirect", async () => {
    const sample = remoteFixture();
    const response = new Response(sample.manifestContent);
    Object.defineProperty(response, "url", { value: "http://example.test/manifest.json" });
    await expect(downloadAndInstallResourcePack({
      rootDirectory: join(tmpdir(), `quran-unused-${crypto.randomUUID()}`),
      manifestUrl: "https://example.test/manifest.json",
      dataUrl: "https://example.test/data.json",
      ...pinned(sample),
      maxManifestBytes: 32_000,
      maxDataBytes: 32_000,
      fetch: (async () => response) as unknown as typeof fetch,
    })).rejects.toMatchObject({ code: "io_failed" });
  });

  test("rejects insecure download URLs before making a request", async () => {
    let requests = 0;
    await expect(downloadAndInstallResourcePack({
      rootDirectory: "/tmp/quran-unused-test-root",
      manifestUrl: "http://example.test/manifest.json",
      dataUrl: "https://example.test/data.json",
      expectedId: "test",
      expectedVersion: "v1",
      expectedManifestSha256: "0".repeat(64),
      expectedDataSha256: "0".repeat(64),
      expectedDataBytes: 1,
      expectedKind: "recitation",
      expectedProvider: "Test",
      expectedSourceUrl: "https://example.test/source",
      maxManifestBytes: 100,
      maxDataBytes: 100,
      fetch: (async () => { requests += 1; return new Response(); }) as unknown as typeof fetch,
    })).rejects.toMatchObject({ code: "io_failed" });
    expect(requests).toBe(0);
  });

  test("preserves cancellation while waiting for response headers", async () => {
    const root = mkdtempSync(join(tmpdir(), "quran-remote-pack-test-"));
    temporaryDirectories.push(root);
    const sample = remoteFixture();
    const controller = new AbortController();
    const fetcher = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) {
        reject(init.signal.reason);
        return;
      }
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })) as typeof fetch;
    const installing = downloadAndInstallResourcePack({
      rootDirectory: join(root, "resources"),
      manifestUrl: "https://example.test/manifest.json",
      dataUrl: "https://example.test/data.json",
      ...pinned(sample),
      maxManifestBytes: 32_000,
      maxDataBytes: 32_000,
      fetch: fetcher,
      signal: controller.signal,
    });
    controller.abort(new Error("cancelled in test"));
    await expect(installing).rejects.toMatchObject({ code: "cancelled" });
  });
});
