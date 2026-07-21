import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createResourcePackManager, ResourcePackError, type InstalledResourcePack } from "./manager.ts";

export interface RemotePackDownload {
  readonly rootDirectory: string;
  readonly manifestUrl: string;
  readonly dataUrl: string;
  readonly expectedId: string;
  readonly expectedVersion: string;
  readonly expectedManifestSha256: string;
  readonly expectedDataSha256: string;
  readonly expectedDataBytes: number;
  readonly expectedKind: string;
  readonly expectedProvider: string;
  readonly expectedSourceUrl: string;
  readonly maxManifestBytes: number;
  readonly maxDataBytes: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (received: number, total?: number) => void;
  readonly fetch?: typeof globalThis.fetch;
}

function secureUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new ResourcePackError("io_failed", "Remote resource packs require HTTPS", false);
  return url;
}

async function downloadFile(
  url: URL,
  path: string,
  maxBytes: number,
  fetcher: typeof globalThis.fetch,
  signal?: AbortSignal,
  onProgress?: (received: number, total?: number) => void,
): Promise<{ readonly bytes: number; readonly sha256: string }> {
  const response = await fetcher(url, { signal, redirect: "follow" }).catch((cause) => {
    if (signal?.aborted) throw new ResourcePackError("cancelled", "Resource download was cancelled", true, signal.reason);
    throw new ResourcePackError("io_failed", `Could not download ${url.hostname}`, true, cause);
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new ResourcePackError("io_failed", `Download failed with HTTP ${response.status}`, response.status >= 500);
  }
  if (response.url && new URL(response.url).protocol !== "https:") {
    await response.body.cancel().catch(() => {});
    throw new ResourcePackError("io_failed", "Remote resource pack redirected to an insecure URL", false);
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body.cancel().catch(() => {});
    throw new ResourcePackError("size_mismatch", `Remote file exceeds the ${maxBytes}-byte safety limit`, false);
  }
  let received = 0;
  const hasher = new Bun.CryptoHasher("sha256");
  const reader = response.body.getReader();
  const sink = Bun.file(path).writer();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > maxBytes) {
        await reader.cancel("size limit exceeded");
        throw new ResourcePackError("size_mismatch", `Remote file exceeds the ${maxBytes}-byte safety limit`, false);
      }
      onProgress?.(received, Number.isFinite(declared) ? declared : undefined);
      hasher.update(chunk.value);
      sink.write(chunk.value);
    }
    return { bytes: received, sha256: hasher.digest("hex") };
  } catch (cause) {
    if (signal?.aborted) throw new ResourcePackError("cancelled", "Resource download was cancelled", true, signal.reason);
    if (cause instanceof ResourcePackError) throw cause;
    throw new ResourcePackError("io_failed", `Could not save download from ${url.hostname}`, true, cause);
  } finally {
    reader.releaseLock();
    await sink.end();
  }
}

export async function downloadAndInstallResourcePack(options: RemotePackDownload): Promise<InstalledResourcePack> {
  const manager = createResourcePackManager(options.rootDirectory);
  const installed = (await manager.list()).find((pack) =>
    pack.manifest.id === options.expectedId && pack.manifest.version === options.expectedVersion,
  );
  if (installed) {
    const manifest = installed.manifest;
    if (manifest.kind !== options.expectedKind
      || manifest.source.provider !== options.expectedProvider
      || manifest.source.url !== options.expectedSourceUrl
      || manifest.content.bytes !== options.expectedDataBytes
      || manifest.content.sha256 !== options.expectedDataSha256) {
      throw new ResourcePackError("invalid_manifest", "Installed resource pack does not match the application-pinned identity", false);
    }
    const verification = await manager.verify(options.expectedId, options.expectedVersion);
    if (!verification.ok
      || verification.actualBytes !== options.expectedDataBytes
      || verification.actualSha256 !== options.expectedDataSha256) {
      throw new ResourcePackError("checksum_mismatch", "Installed resource pack failed integrity verification; remove it before downloading a clean copy", false);
    }
    return installed;
  }

  const manifestUrl = secureUrl(options.manifestUrl);
  const dataUrl = secureUrl(options.dataUrl);
  const temporary = await mkdtemp(join(tmpdir(), "quran-sh-pack-"));
  const manifestPath = join(temporary, "manifest.json");
  const dataPath = join(temporary, "data.json");
  const fetcher = options.fetch ?? globalThis.fetch;
  try {
    const manifestDownload = await downloadFile(manifestUrl, manifestPath, options.maxManifestBytes, fetcher, options.signal);
    if (manifestDownload.sha256 !== options.expectedManifestSha256) {
      throw new ResourcePackError("checksum_mismatch", "Downloaded manifest does not match the application-pinned checksum", false);
    }
    const manifest: unknown = JSON.parse(await Bun.file(manifestPath).text());
    const candidate = manifest as {
      id?: unknown;
      version?: unknown;
      kind?: unknown;
      source?: { provider?: unknown; url?: unknown };
      content?: { bytes?: unknown; sha256?: unknown };
    };
    if (!manifest || typeof manifest !== "object"
      || candidate.id !== options.expectedId
      || candidate.version !== options.expectedVersion
      || candidate.kind !== options.expectedKind
      || candidate.source?.provider !== options.expectedProvider
      || candidate.source?.url !== options.expectedSourceUrl
      || candidate.content?.bytes !== options.expectedDataBytes
      || candidate.content?.sha256 !== options.expectedDataSha256) {
      throw new ResourcePackError("invalid_manifest", "Downloaded resource pack identity does not match the requested pack", false);
    }
    const dataDownload = await downloadFile(dataUrl, dataPath, options.maxDataBytes, fetcher, options.signal, options.onProgress);
    if (dataDownload.bytes !== options.expectedDataBytes || dataDownload.sha256 !== options.expectedDataSha256) {
      throw new ResourcePackError("checksum_mismatch", "Downloaded resource data does not match the application-pinned checksum", false);
    }
    return await manager.importPack(manifestPath, dataPath, options.signal);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
