import { mkdir, readFile, rename, rm, stat, statfs } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface TilawaModelFile { readonly name: string; readonly url: string; readonly bytes: number; readonly sha256: string }
export interface TilawaModelManifest {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly source: string;
  readonly license: string;
  readonly attribution: string;
  readonly files: readonly TilawaModelFile[];
}

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

async function hash(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const reader = Bun.file(path).stream().getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      hasher.update(chunk.value);
    }
    return hasher.digest("hex");
  } finally {
    reader.releaseLock();
  }
}

export async function installTilawaModel(
  root: string,
  manifest: TilawaModelManifest,
  options: { signal?: AbortSignal; onProgress?: (received: number, total: number) => void } = {},
): Promise<string> {
  if (!SAFE_NAME.test(manifest.version) || !manifest.attribution.trim() || !manifest.files.length) throw new Error("Invalid Tilawa model manifest");
  const target = join(root, manifest.version);
  const staging = join(root, ".staging", crypto.randomUUID());
  const total = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
  let received = 0;
  await mkdir(root, { recursive: true });
  const filesystem = await statfs(root);
  const available = Number(filesystem.bavail) * Number(filesystem.bsize);
  if (available < total + 16 * 1024 * 1024) {
    throw new Error(`Tilawa needs ${total} bytes plus staging headroom, but only ${available} bytes are available`);
  }
  await mkdir(staging, { recursive: true });
  try {
    for (const file of manifest.files) {
      if (!SAFE_NAME.test(file.name) || !URL.canParse(file.url) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error(`Invalid model file: ${file.name}`);
      options.signal?.throwIfAborted();
      const response = await fetch(file.url, { signal: options.signal });
      if (!response.ok) throw new Error(`Model download failed: ${response.status} ${basename(file.url)}`);
      const path = join(staging, file.name);
      if (!response.body) throw new Error(`Model download returned no body for ${file.name}`);
      const reader = response.body.getReader();
      const writer = Bun.file(path).writer();
      const hasher = new Bun.CryptoHasher("sha256");
      let fileBytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          options.signal?.throwIfAborted();
          hasher.update(chunk.value);
          await writer.write(chunk.value);
          fileBytes += chunk.value.byteLength;
          options.onProgress?.(received + fileBytes, total);
        }
      } finally {
        await writer.end();
        reader.releaseLock();
      }
      if (fileBytes !== file.bytes) throw new Error(`Size mismatch for ${file.name}`);
      if (hasher.digest("hex") !== file.sha256) throw new Error(`Checksum mismatch for ${file.name}`);
      received += fileBytes;
    }
    await Bun.write(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await mkdir(dirname(target), { recursive: true });
    const backup = `${target}.previous-${crypto.randomUUID()}`;
    const hadPrevious = await stat(target).then(() => true).catch(() => false);
    if (hadPrevious) await rename(target, backup);
    try {
      await rename(staging, target);
      if (hadPrevious) await rm(backup, { recursive: true, force: true });
    } catch (cause) {
      if (hadPrevious) await rename(backup, target).catch(() => {});
      throw cause;
    }
    return target;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function verifyTilawaModel(directory: string): Promise<boolean> {
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as TilawaModelManifest;
  for (const file of manifest.files) {
    const path = join(directory, file.name);
    if ((await stat(path)).size !== file.bytes || await hash(path) !== file.sha256) return false;
  }
  return true;
}
