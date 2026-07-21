import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createResourcePackManager,
  areResourcePacksCompatible,
  type ResourcePackManifestInput,
} from "../../src/features/resources/manager.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function fixture(kind: ResourcePackManifestInput["kind"] = "quran-script") {
  const directory = mkdtempSync(join(tmpdir(), "quran-pack-test-"));
  temporaryDirectories.push(directory);
  const dataPath = join(directory, "pack.json");
  const content = JSON.stringify({ verses: [{ verse_key: "1:1", words: [] }] });
  await Bun.write(dataPath, content);
  const bytes = Buffer.byteLength(content);
  const sha256 = new Bun.CryptoHasher("sha256").update(content).digest("hex");
  const manifest: ResourcePackManifestInput = {
    schemaVersion: 1,
    id: `qul.test.${kind}`,
    version: "2026-07-21",
    title: `Test ${kind}`,
    kind,
    format: "json",
    source: {
      provider: "QUL",
      resourceId: "test-1",
      url: "https://qul.tarteel.ai/resources",
      retrievedAt: "2026-07-21T00:00:00.000Z",
    },
    content: { bytes, sha256 },
    license: {
      name: "Test-only",
      url: "https://example.invalid/license",
      attribution: "Fixture data",
      redistribution: "local-import-only",
    },
    compatibility: { narration: "hafs", script: "uthmani" },
  };
  const manifestPath = join(directory, "manifest.json");
  await Bun.write(manifestPath, JSON.stringify(manifest));
  return { directory, dataPath, manifestPath, manifest };
}

describe("QUL resource pack manager", () => {
  test("imports, lists, verifies, reports licensing, and removes a pack", async () => {
    const sample = await fixture();
    const root = join(sample.directory, "installed");
    const manager = createResourcePackManager(root);

    const installed = await manager.importPack(sample.manifestPath, sample.dataPath);
    expect(installed.manifest.id).toBe(sample.manifest.id);
    expect(existsSync(installed.dataPath)).toBe(true);

    expect(await manager.list()).toHaveLength(1);
    expect(await manager.verify(sample.manifest.id)).toMatchObject({ ok: true });
    expect((await manager.licenses())[0]).toMatchObject({
      id: sample.manifest.id,
      attribution: "Fixture data",
    });

    await manager.remove(sample.manifest.id);
    expect(await manager.list()).toEqual([]);
  });

  test("fails checksum validation atomically", async () => {
    const sample = await fixture();
    const root = join(sample.directory, "installed");
    const badManifest = {
      ...sample.manifest,
      content: { ...sample.manifest.content, sha256: "0".repeat(64) },
    };
    await Bun.write(sample.manifestPath, JSON.stringify(badManifest));
    const manager = createResourcePackManager(root);

    await expect(manager.importPack(sample.manifestPath, sample.dataPath)).rejects.toMatchObject({
      name: "ResourcePackError",
      code: "checksum_mismatch",
    });
    expect(await manager.list()).toEqual([]);
    expect(existsSync(join(root, sample.manifest.id))).toBe(false);
  });

  test("rejects malformed manifests before creating an installed directory", async () => {
    const sample = await fixture();
    const root = join(sample.directory, "installed");
    await Bun.write(sample.manifestPath, JSON.stringify({ id: "../../escape" }));
    const manager = createResourcePackManager(root);

    await expect(manager.importPack(sample.manifestPath, sample.dataPath)).rejects.toMatchObject({
      name: "ResourcePackError",
      code: "invalid_manifest",
    });
    expect(await manager.list()).toEqual([]);
  });

  test("honours cancellation before promotion", async () => {
    const sample = await fixture();
    const root = join(sample.directory, "installed");
    const manager = createResourcePackManager(root);
    const controller = new AbortController();
    controller.abort(new Error("cancelled by test"));

    await expect(
      manager.importPack(sample.manifestPath, sample.dataPath, controller.signal),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(await manager.list()).toEqual([]);
  });

  test("rejects invalid Quran keys and HTML before promotion", async () => {
    const sample = await fixture();
    const content = JSON.stringify([{ verse_key: "1:999", text: "<script>bad()</script>" }]);
    await Bun.write(sample.dataPath, content);
    const manifest = { ...sample.manifest, content: { bytes: Buffer.byteLength(content), sha256: new Bun.CryptoHasher("sha256").update(content).digest("hex") } };
    await Bun.write(sample.manifestPath, JSON.stringify(manifest));
    await expect(createResourcePackManager(join(sample.directory, "installed")).importPack(sample.manifestPath, sample.dataPath))
      .rejects.toMatchObject({ code: "invalid_content" });
  });

  test("selects numeric resource versions naturally", async () => {
    const sample = await fixture();
    const manager = createResourcePackManager(join(sample.directory, "installed"));
    for (const version of ["v0.2.0", "v0.10.0"]) {
      const manifest = { ...sample.manifest, version };
      await Bun.write(sample.manifestPath, JSON.stringify(manifest));
      await manager.importPack(sample.manifestPath, sample.dataPath);
    }
    expect((await manager.verify(sample.manifest.id)).version).toBe("v0.10.0");
  });

  test("prevents joins across incompatible narration or script revisions", async () => {
    const sample = await fixture();
    expect(areResourcePacksCompatible(sample.manifest, { ...sample.manifest, compatibility: { narration: "warsh", script: "uthmani" } })).toBe(false);
    expect(areResourcePacksCompatible(sample.manifest, { ...sample.manifest, compatibility: { narration: "hafs", script: "uthmani", language: "fr" } })).toBe(true);
  });
});
