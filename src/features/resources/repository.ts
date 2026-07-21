import { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";
import type { InstalledResourcePack, ResourcePackKind } from "./manager.ts";

export interface ResourceRow {
  readonly verseKey?: string;
  readonly wordKey?: string;
  readonly text?: string;
  readonly root?: string;
  readonly lemma?: string;
  readonly partOfSpeech?: string;
  readonly topic?: string;
  readonly page?: number;
  readonly line?: number;
  readonly audioUrl?: string;
  readonly segments?: readonly [number, number, number][];
  readonly provenance?: {
    readonly packId: string;
    readonly version: string;
    readonly provider: string;
    readonly sourceUrl: string;
    readonly license: string;
    readonly attribution: string;
  };
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface ResourceRepository {
  readonly kind: ResourcePackKind;
  verse(verseKey: string): readonly ResourceRow[];
  word(wordKey: string): readonly ResourceRow[];
  search(query: string, limit?: number): readonly ResourceRow[];
  close(): void;
}

function normalizeRow(value: unknown, pack?: InstalledResourcePack): ResourceRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.raw_json === "string") {
    try { return normalizeRow(JSON.parse(raw.raw_json), pack); }
    catch { return null; }
  }
  const verseKey = stringValue(raw.verse_key ?? raw.verseKey ?? raw.ayah_key ?? raw.ayahKey);
  const wordKey = stringValue(raw.location ?? raw.word_key ?? raw.wordKey);
  const text = stringValue(raw.text ?? raw.translation ?? raw.tafsir ?? raw.content ?? raw.word);
  const segments = Array.isArray(raw.segments)
    ? raw.segments.flatMap((segment): [number, number, number][] => {
        if (!Array.isArray(segment) || segment.length < 3 || !segment.slice(0, 3).every(Number.isFinite)) return [];
        return [[Number(segment[0]), Number(segment[1]), Number(segment[2])]];
      })
    : undefined;
  return {
    verseKey,
    wordKey,
    text,
    root: stringValue(raw.root),
    lemma: stringValue(raw.lemma),
    partOfSpeech: stringValue(raw.pos ?? raw.part_of_speech),
    topic: stringValue(raw.topic ?? raw.name),
    page: numberValue(raw.page_number ?? raw.page),
    line: numberValue(raw.line_number ?? raw.line),
    audioUrl: stringValue(raw.audio_url ?? raw.audioUrl),
    segments,
    provenance: pack ? {
      packId: pack.manifest.id,
      version: pack.manifest.version,
      provider: pack.manifest.source?.provider ?? pack.manifest.license?.attribution ?? pack.manifest.id,
      sourceUrl: pack.manifest.source?.url ?? "",
      license: pack.manifest.license?.name ?? "",
      attribution: pack.manifest.license?.attribution ?? "",
    } : undefined,
    raw,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function rowsFromJson(value: unknown, pack?: InstalledResourcePack): ResourceRow[] {
  const records = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>).flatMap((entry) => Array.isArray(entry) ? entry : [entry])
      : [];
  return records.flatMap((row) => {
    const normalized = normalizeRow(row, pack);
    return normalized ? [normalized] : [];
  });
}

function createMemoryRepository(kind: ResourcePackKind, rows: readonly ResourceRow[]): ResourceRepository {
  let activeRows = [...rows];
  let closed = false;
  const byVerse = new Map<string, ResourceRow[]>();
  const byWord = new Map<string, ResourceRow[]>();
  for (const row of rows) {
    if (row.verseKey) byVerse.set(row.verseKey, [...(byVerse.get(row.verseKey) ?? []), row]);
    if (row.wordKey) byWord.set(row.wordKey, [...(byWord.get(row.wordKey) ?? []), row]);
  }
  return {
    kind,
    verse: (key) => closed ? [] : byVerse.get(key) ?? [],
    word: (key) => closed ? [] : byWord.get(key) ?? [],
    search(query, limit = 50) {
      const normalized = query.toLocaleLowerCase();
      if (!normalized) return [];
      if (closed) return [];
      return activeRows.filter((row) => [row.text, row.root, row.lemma, row.topic]
        .some((field) => field?.toLocaleLowerCase().includes(normalized))).slice(0, Math.max(0, limit));
    },
    close() {
      if (closed) return;
      closed = true;
      activeRows = [];
      byVerse.clear();
      byWord.clear();
    },
  };
}

export async function openResourceRepository(pack: InstalledResourcePack): Promise<ResourceRepository> {
  if (pack.manifest.format === "json" && !pack.indexPath) {
    const parsed: unknown = JSON.parse(await readFile(pack.dataPath, "utf8"));
    return createMemoryRepository(pack.manifest.kind, rowsFromJson(parsed, pack));
  }

  const database = new Database(pack.indexPath ?? pack.dataPath, { readonly: true, strict: true });
  const tableQuery = database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  const tables = tableQuery.all() as { name: string }[];
  tableQuery.finalize();
  const normalizedTable = `resource_${pack.manifest.kind.replaceAll("-", "_")}`;
  const table = tables.find(({ name }) => name === normalizedTable)?.name ?? tables[0]?.name;
  if (!table || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    database.close();
    return createMemoryRepository(pack.manifest.kind, []);
  }
  const columnQuery = database.query(`PRAGMA table_info("${table}")`);
  const columns = (columnQuery.all() as { name: string }[])
    .map(({ name }) => name)
    .filter((name) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name));
  columnQuery.finalize();
  const pick = (...candidates: string[]) => candidates.find((candidate) => columns.includes(candidate));
  const verseColumn = pick("verse_key", "verseKey", "ayah_key", "ayahKey");
  const wordColumn = pick("location", "word_key", "wordKey");
  const searchableColumns = ["text", "translation", "tafsir", "content", "word", "root", "lemma", "topic", "name"]
    .filter((column) => columns.includes(column));
  let closed = false;
  const quote = (identifier: string) => `"${identifier}"`;
  const queryBy = (column: string | undefined, value: string, limit = 500): ResourceRow[] => {
    if (closed || !column) return [];
    const statement = database.query(`SELECT * FROM "${table}" WHERE ${quote(column)} = ? LIMIT ?`);
    try { return rowsFromJson(statement.all(value, Math.max(0, Math.min(500, limit))), pack); }
    finally { statement.finalize(); }
  };
  return {
    kind: pack.manifest.kind,
    verse: (key) => queryBy(verseColumn, key),
    word: (key) => queryBy(wordColumn, key),
    search(query, limit = 50) {
      if (closed || !query || searchableColumns.length === 0) return [];
      const maximum = Math.max(0, Math.min(200, limit));
      const where = searchableColumns.map((column) => `${quote(column)} LIKE ? ESCAPE '\\'`).join(" OR ");
      const escaped = query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
      const statement = database.query(`SELECT * FROM "${table}" WHERE ${where} LIMIT ?`);
      try { return rowsFromJson(statement.all(...searchableColumns.map(() => `%${escaped}%`), maximum), pack); }
      finally { statement.finalize(); }
    },
    close() {
      if (closed) return;
      closed = true;
      database.close();
    },
  };
}
