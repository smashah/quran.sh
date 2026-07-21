import type { ResourceRow } from "../resources/repository.ts";
import type { HadithGrade, HadithPage, HadithRecord, HadithText } from "./types.ts";

const UNSAFE_TERMINAL_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

function safeText(value: string, label: string): string {
  if (UNSAFE_TERMINAL_TEXT.test(value)) throw new Error(`${label} contains unsafe terminal control characters`);
  return value;
}

function stringField(raw: Readonly<Record<string, unknown>>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return safeText(value.trim(), "Hadith metadata");
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function gradesFrom(value: unknown): HadithGrade[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = candidate as Record<string, unknown>;
    const grade = stringField(raw, "grade");
    if (!grade) return [];
    return [{ grade, gradedBy: stringField(raw, "graded_by", "gradedBy", "grade_by", "gradeBy") }];
  });
}

function textFrom(row: ResourceRow): HadithText | null {
  if (!row.text?.trim()) return null;
  const language = row.language === "ar" || row.direction === "rtl" || /[\u0600-\u06ff]/u.test(row.text) ? "ar" : "en";
  return {
    urn: typeof row.raw.urn === "number" ? row.raw.urn : undefined,
    language,
    direction: language === "ar" ? "rtl" : "ltr",
    chapterNumber: stringField(row.raw, "chapter_number", "chapterNumber"),
    chapterTitle: stringField(row.raw, "chapter_title", "chapterTitle"),
    body: row.text.trim(),
    grades: gradesFrom(row.raw.grades),
  };
}

export function hadithPageFromLocalRows(verseKey: string, rows: readonly ResourceRow[]): HadithPage {
  const grouped = new Map<string, { row: ResourceRow; texts: HadithText[] }>();
  rows.forEach((row, index) => {
    const collection = stringField(row.raw, "collection") ?? "hadith";
    const hadithNumber = stringField(row.raw, "hadith_number", "hadithNumber", "our_hadith_number", "ourHadithNumber") ?? String(index + 1);
    const id = `${row.provenance?.packId ?? "local"}:${collection}:${hadithNumber}`;
    const group = grouped.get(id) ?? { row, texts: [] };
    const text = textFrom(row);
    if (text) group.texts.push(text);
    grouped.set(id, group);
  });
  const records: HadithRecord[] = [...grouped].flatMap(([id, { row, texts }]) => {
    if (texts.length === 0) return [];
    const collection = stringField(row.raw, "collection") ?? "hadith";
    const hadithNumber = stringField(row.raw, "hadith_number", "hadithNumber", "our_hadith_number", "ourHadithNumber") ?? "reference";
    return [{
      id,
      collection,
      name: stringField(row.raw, "name", "collection_name", "collectionName") ?? collection,
      bookNumber: stringField(row.raw, "book_number", "bookNumber"),
      chapterId: stringField(row.raw, "chapter_id", "chapterId"),
      hadithNumber,
      texts,
      provenance: {
        provider: safeText(row.provenance?.provider ?? "Installed resource pack", "Hadith provider"),
        sourceUrl: safeText(row.provenance?.sourceUrl ?? "", "Hadith source URL"),
        termsUrl: stringField(row.raw, "terms_url", "termsUrl"),
        license: safeText(row.provenance?.license ?? "See installed pack manifest", "Hadith license"),
        attribution: safeText(row.provenance?.attribution ?? "Attribution unavailable", "Hadith attribution"),
      },
    }];
  });
  return { verseKey, records: records.slice(0, 12), page: 1, hasMore: false, truncated: records.length > 12, source: "local" };
}
