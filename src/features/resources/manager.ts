import { Database } from "bun:sqlite";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { Effect, Schema } from "effect";
import { parseVerseKey, parseWordKey } from "../../domain/quran-coordinate.ts";

export const RESOURCE_PACK_KINDS = [
  "quran-script",
  "recitation",
  "translation",
  "tafsir",
  "morphology",
  "topics",
  "similar-ayahs",
  "mutashabihat",
  "mushaf-layout",
  "mushaf-image",
] as const;

export type ResourcePackKind = (typeof RESOURCE_PACK_KINDS)[number];
export type ResourcePackFormat = "json" | "sqlite";

export interface ResourcePackManifestInput {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly kind: ResourcePackKind;
  readonly format: ResourcePackFormat;
  readonly source: {
    readonly provider: string;
    readonly resourceId: string;
    readonly url: string;
    readonly retrievedAt: string;
  };
  readonly content: {
    readonly bytes: number;
    readonly sha256: string;
  };
  readonly license: {
    readonly name: string;
    readonly url: string;
    readonly attribution: string;
    readonly redistribution: "allowed" | "local-import-only" | "unknown";
  };
  readonly compatibility: Readonly<Record<string, string>>;
}

export interface InstalledResourcePack {
  readonly manifest: ResourcePackManifestInput;
  readonly directory: string;
  readonly dataPath: string;
  readonly indexPath?: string;
}

export interface PackVerification {
  readonly ok: boolean;
  readonly id: string;
  readonly version: string;
  readonly expectedBytes: number;
  readonly actualBytes: number;
  readonly expectedSha256: string;
  readonly actualSha256: string;
}

export interface ResourceLicense {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly url: string;
  readonly attribution: string;
  readonly redistribution: ResourcePackManifestInput["license"]["redistribution"];
}

const JOIN_COMPATIBILITY_KEYS = ["narration", "script", "mushaf", "coordinateSchema", "timingSchema"] as const;

export function areResourcePacksCompatible(a: ResourcePackManifestInput, b: ResourcePackManifestInput): boolean {
  return JOIN_COMPATIBILITY_KEYS.every((key) => {
    const left = a.compatibility[key];
    const right = b.compatibility[key];
    return left === undefined || right === undefined || left === right;
  });
}

export type ResourcePackErrorCode =
  | "invalid_manifest"
  | "checksum_mismatch"
  | "size_mismatch"
  | "invalid_content"
  | "already_installed"
  | "not_found"
  | "cancelled"
  | "io_failed";

export class ResourcePackError extends Error {
  override readonly name = "ResourcePackError";

  constructor(
    readonly code: ResourcePackErrorCode,
    message: string,
    readonly retryable: boolean,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}

const SourceSchema = Schema.Struct({
  provider: Schema.String,
  resourceId: Schema.String,
  url: Schema.String,
  retrievedAt: Schema.String,
});
const ContentSchema = Schema.Struct({
  bytes: Schema.Number,
  sha256: Schema.String,
});
const LicenseSchema = Schema.Struct({
  name: Schema.String,
  url: Schema.String,
  attribution: Schema.String,
  redistribution: Schema.Literal("allowed", "local-import-only", "unknown"),
});
const ManifestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: Schema.String,
  version: Schema.String,
  title: Schema.String,
  kind: Schema.Literal(...RESOURCE_PACK_KINDS),
  format: Schema.Literal("json", "sqlite"),
  source: SourceSchema,
  content: ContentSchema,
  license: LicenseSchema,
  compatibility: Schema.Record({ key: Schema.String, value: Schema.String }),
});

const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function cancelled(signal?: AbortSignal): never | void {
  if (signal?.aborted) {
    throw new ResourcePackError("cancelled", "Resource import was cancelled", true, signal.reason);
  }
}

async function parseManifest(path: string): Promise<ResourcePackManifestInput> {
  try {
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    const decoded = await Schema.decodeUnknownPromise(ManifestSchema)(raw);
    if (!SAFE_SEGMENT.test(decoded.id) || !SAFE_SEGMENT.test(decoded.version)) {
      throw new Error("id and version must be safe path segments");
    }
    if (!Number.isSafeInteger(decoded.content.bytes) || decoded.content.bytes < 0) {
      throw new Error("content.bytes must be a non-negative integer");
    }
    if (!SHA256.test(decoded.content.sha256)) {
      throw new Error("content.sha256 must be a lowercase SHA-256 digest");
    }
    if (!URL.canParse(decoded.source.url) || !URL.canParse(decoded.license.url)) {
      throw new Error("source and license URLs must be absolute");
    }
    if (!decoded.license.attribution.trim()) {
      throw new Error("license attribution is required");
    }
    return decoded;
  } catch (cause) {
    if (cause instanceof ResourcePackError) throw cause;
    throw new ResourcePackError("invalid_manifest", `Invalid resource manifest: ${basename(path)}`, false, cause);
  }
}

async function sha256(path: string): Promise<string> {
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

function validateResourceObject(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const row = value as Record<string, unknown>;
  const verse = row.verse_key ?? row.verseKey ?? row.ayah_key ?? row.ayahKey;
  const word = row.location ?? row.word_key ?? row.wordKey;
  if (verse !== undefined && (typeof verse !== "string" || !parseVerseKey(verse))) {
    throw new Error(`Invalid verse key: ${String(verse)}`);
  }
  if (word !== undefined && (typeof word !== "string" || !parseWordKey(word))) {
    throw new Error(`Invalid word key: ${String(word)}`);
  }
  for (const field of [row.text, row.translation, row.tafsir, row.content]) {
    if (typeof field === "string" && /<\/?(?:script|style|iframe|object|embed|[a-z][a-z0-9-]*)\b/i.test(field)) {
      throw new Error("HTML/script content requires a reviewed structural importer");
    }
  }
  return verse !== undefined || word !== undefined ? 1 : 0;
}

function validateJsonTree(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((count, entry) => count + validateJsonTree(entry), 0);
  if (!value || typeof value !== "object") return 0;
  const own = validateResourceObject(value);
  return own + Object.values(value as Record<string, unknown>).reduce<number>((count, entry) => count + validateJsonTree(entry), 0);
}

function coordinateObjects(value: unknown, output: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const entry of value) coordinateObjects(entry, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  const row = value as Record<string, unknown>;
  if (row.verse_key ?? row.verseKey ?? row.ayah_key ?? row.ayahKey ?? row.location ?? row.word_key ?? row.wordKey) output.push(row);
  for (const entry of Object.values(row)) coordinateObjects(entry, output);
  return output;
}

function normalizedValue(row: Record<string, unknown>, ...keys: string[]): string | number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return null;
}

function compactResourceRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key, value]) =>
    value === null || ["string", "number", "boolean"].includes(typeof value) || (key === "segments" && Array.isArray(value)),
  ));
}

async function createNormalizedIndex(sourcePath: string, format: ResourcePackFormat, kind: ResourcePackKind, targetPath: string): Promise<void> {
  const table = `resource_${kind.replaceAll("-", "_")}`;
  const target = new Database(targetPath, { create: true, strict: true });
  const source = format === "sqlite" ? new Database(sourcePath, { readonly: true, strict: true }) : null;
  try {
    target.exec(`CREATE TABLE "${table}" (
      verse_key TEXT, word_key TEXT, text TEXT, root TEXT, lemma TEXT, part_of_speech TEXT,
      topic TEXT, page INTEGER, line INTEGER, audio_url TEXT, raw_json TEXT NOT NULL
    );
    CREATE INDEX "${table}_verse" ON "${table}" (verse_key);
    CREATE INDEX "${table}_word" ON "${table}" (word_key);
    CREATE INDEX "${table}_root" ON "${table}" (root);
    CREATE INDEX "${table}_lemma" ON "${table}" (lemma);`);
    const insert = target.prepare(`INSERT INTO "${table}" VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const writeRows = target.transaction((rows: Iterable<Record<string, unknown>>) => {
      for (const row of rows) insert.run(
        normalizedValue(row, "verse_key", "verseKey", "ayah_key", "ayahKey"), normalizedValue(row, "location", "word_key", "wordKey"),
        normalizedValue(row, "text", "translation", "tafsir", "content", "word"), normalizedValue(row, "root"), normalizedValue(row, "lemma"),
        normalizedValue(row, "pos", "part_of_speech"), normalizedValue(row, "topic", "name"), normalizedValue(row, "page_number", "page"),
        normalizedValue(row, "line_number", "line"), normalizedValue(row, "audio_url", "audioUrl"), JSON.stringify(compactResourceRow(row)),
      );
    });
    if (format === "json") {
      const parsed: unknown = JSON.parse(await readFile(sourcePath, "utf8"));
      writeRows(coordinateObjects(parsed));
    } else if (source) {
      const tables = source.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
      for (const { name } of tables) {
        const quoted = name.replaceAll('"', '""');
        writeRows(source.query(`SELECT * FROM "${quoted}"`).iterate() as Iterable<Record<string, unknown>>);
      }
    }
    if (kind === "mushaf-layout") {
      const coverage = target.query(`SELECT COUNT(DISTINCT verse_key) AS verses, COUNT(DISTINCT page) AS pages FROM "${table}" WHERE verse_key IS NOT NULL AND page IS NOT NULL AND line IS NOT NULL`).get() as { verses: number; pages: number };
      if (coverage.verses !== 6_236 || coverage.pages !== 604) {
        throw new ResourcePackError("invalid_content", `Mushaf layout coverage is incomplete: ${coverage.verses}/6236 ayat across ${coverage.pages}/604 pages`, false);
      }
    }
  } finally {
    source?.close();
    target.close();
  }
}

async function validateContent(path: string, format: ResourcePackFormat, signal?: AbortSignal): Promise<void> {
  try {
    if (format === "json") {
      const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
      cancelled(signal);
      if (validateJsonTree(parsed) === 0) throw new Error("Resource pack contains no canonical Quran coordinates");
      return;
    }

    const database = new Database(path, { readonly: true, strict: true });
    try {
      const result = database.query("PRAGMA quick_check").get() as Record<string, unknown> | null;
      if (!result || !Object.values(result).includes("ok")) {
        throw new Error("SQLite quick_check did not return ok");
      }
      const tables = database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
      let coordinateRows = 0;
      let rowCount = 0;
      for (const { name } of tables) {
        const quoted = name.replaceAll('"', '""');
        for (const row of database.query(`SELECT * FROM "${quoted}"`).iterate()) {
          coordinateRows += validateResourceObject(row);
          rowCount += 1;
          if (rowCount % 1_000 === 0) cancelled(signal);
        }
      }
      if (coordinateRows === 0) throw new Error("Resource pack contains no canonical Quran coordinates");
    } finally {
      database.close();
    }
  } catch (cause) {
    if (cause instanceof ResourcePackError) throw cause;
    throw new ResourcePackError("invalid_content", "Resource data is not valid for its declared format", false, cause);
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function installedAt(directory: string): Promise<InstalledResourcePack> {
  const manifest = await parseManifest(join(directory, "manifest.json"));
  const indexPath = join(directory, "index.sqlite");
  return {
    manifest,
    directory,
    dataPath: join(directory, `data.${manifest.format === "sqlite" ? "sqlite" : "json"}`),
    indexPath: await stat(indexPath).then(() => indexPath).catch(() => undefined),
  };
}

async function subdirectories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => join(path, entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export interface ResourcePackManager {
  importPack(manifestPath: string, dataPath: string, signal?: AbortSignal): Promise<InstalledResourcePack>;
  list(): Promise<InstalledResourcePack[]>;
  verify(id: string, version?: string): Promise<PackVerification>;
  licenses(): Promise<ResourceLicense[]>;
  remove(id: string, version?: string): Promise<void>;
}

export function createResourcePackManager(rootDirectory: string): ResourcePackManager {
  const packDirectory = (id: string, version: string): string => join(rootDirectory, id, version);

  const list = async (): Promise<InstalledResourcePack[]> => {
    const installed: InstalledResourcePack[] = [];
    for (const idDirectory of await subdirectories(rootDirectory)) {
      for (const versionDirectory of await subdirectories(idDirectory)) {
        try {
          installed.push(await installedAt(versionDirectory));
        } catch {
          // A partial/corrupt directory is never advertised as installed.
        }
      }
    }
    return installed.sort((a, b) =>
      a.manifest.id.localeCompare(b.manifest.id) || a.manifest.version.localeCompare(b.manifest.version, undefined, { numeric: true, sensitivity: "base" }),
    );
  };

  const find = async (id: string, version?: string): Promise<InstalledResourcePack> => {
    if (!SAFE_SEGMENT.test(id) || (version !== undefined && !SAFE_SEGMENT.test(version))) {
      throw new ResourcePackError("not_found", `Resource pack not found: ${id}`, false);
    }
    const candidates = (await list()).filter((pack) =>
      pack.manifest.id === id && (version === undefined || pack.manifest.version === version),
    );
    const pack = candidates.at(-1);
    if (!pack) throw new ResourcePackError("not_found", `Resource pack not found: ${id}`, false);
    return pack;
  };

  return {
    async importPack(manifestPath, dataPath, signal) {
      cancelled(signal);
      const manifest = await parseManifest(manifestPath);
      cancelled(signal);

      const fileStat = await stat(dataPath).catch((cause) => {
        throw new ResourcePackError("io_failed", `Cannot read resource data: ${basename(dataPath)}`, true, cause);
      });
      if (fileStat.size !== manifest.content.bytes) {
        throw new ResourcePackError(
          "size_mismatch",
          `Expected ${manifest.content.bytes} bytes, received ${fileStat.size}`,
          false,
        );
      }
      const digest = await sha256(dataPath);
      if (digest !== manifest.content.sha256) {
        throw new ResourcePackError("checksum_mismatch", "Resource data checksum does not match manifest", false);
      }
      await validateContent(dataPath, manifest.format, signal);
      cancelled(signal);

      const finalDirectory = packDirectory(manifest.id, manifest.version);
      if (await directoryExists(finalDirectory)) {
        throw new ResourcePackError(
          "already_installed",
          `${manifest.id}@${manifest.version} is already installed`,
          false,
        );
      }

      const stagingRoot = join(rootDirectory, ".staging");
      const acquire = Effect.tryPromise({
        try: async () => {
          const staging = join(stagingRoot, crypto.randomUUID());
          await mkdir(staging, { recursive: true });
          return staging;
        },
        catch: (cause) => new ResourcePackError("io_failed", "Could not create import staging directory", true, cause),
      });
      const use = (staging: string) => Effect.tryPromise({
        try: async () => {
          cancelled(signal);
          const extension = manifest.format === "sqlite" ? "sqlite" : "json";
          await Promise.all([
            Bun.write(join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n"),
            copyFile(dataPath, join(staging, `data.${extension}`)),
          ]);
          cancelled(signal);
          await createNormalizedIndex(join(staging, `data.${extension}`), manifest.format, manifest.kind, join(staging, "index.sqlite"));
          cancelled(signal);
          await mkdir(dirname(finalDirectory), { recursive: true });
          await rename(staging, finalDirectory);
          return installedAt(finalDirectory);
        },
        catch: (cause) => cause instanceof ResourcePackError
          ? cause
          : new ResourcePackError("io_failed", `Could not install ${manifest.id}`, true, cause),
      });
      const release = (staging: string) => Effect.promise(() => rm(staging, { recursive: true, force: true }));

      try {
        return await Effect.runPromise(Effect.acquireUseRelease(acquire, use, release), { signal });
      } catch (cause) {
        if (signal?.aborted) {
          throw new ResourcePackError("cancelled", "Resource import was cancelled", true, signal.reason);
        }
        throw cause;
      }
    },

    list,

    async verify(id, version) {
      const pack = await find(id, version);
      const [fileStat, actualSha256] = await Promise.all([stat(pack.dataPath), sha256(pack.dataPath)]);
      await validateContent(pack.dataPath, pack.manifest.format);
      const indexOk = pack.indexPath ? await validateContent(pack.indexPath, "sqlite").then(() => true).catch(() => false) : false;
      return {
        ok: indexOk && fileStat.size === pack.manifest.content.bytes && actualSha256 === pack.manifest.content.sha256,
        id: pack.manifest.id,
        version: pack.manifest.version,
        expectedBytes: pack.manifest.content.bytes,
        actualBytes: fileStat.size,
        expectedSha256: pack.manifest.content.sha256,
        actualSha256,
      };
    },

    async licenses() {
      return (await list()).map(({ manifest }) => ({
        id: manifest.id,
        version: manifest.version,
        name: manifest.license.name,
        url: manifest.license.url,
        attribution: manifest.license.attribution,
        redistribution: manifest.license.redistribution,
      }));
    },

    async remove(id, version) {
      const pack = await find(id, version);
      await rm(version ? pack.directory : join(rootDirectory, id), { recursive: true, force: true });
    },
  };
}
