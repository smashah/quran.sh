import { parseWordKey } from "../../domain/quran-coordinate.ts";
import type { ResourceRow } from "../resources/repository.ts";
import type { QuranReadingLine, QuranScriptStyle } from "./types.ts";

export function resourceText(row: ResourceRow, script: QuranScriptStyle): string | null {
  const fields = script === "tajweed"
    ? [row.raw.code_v2]
    : script === "indopak"
      ? [row.raw.text_indopak, row.raw.text_indopak_nastaleeq]
      : [row.raw.text_uthmani, row.raw.qpc_uthmani_hafs, row.text];
  return fields.find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? null;
}

export function wordPosition(row: ResourceRow): number {
  const parsed = row.wordKey ? parseWordKey(row.wordKey) : null;
  return parsed?.word ?? Number(row.raw.position ?? Number.MAX_SAFE_INTEGER);
}

function rowsByPack(rows: readonly ResourceRow[]): readonly ResourceRow[][] {
  const groups = new Map<string, ResourceRow[]>();
  for (const row of rows) {
    const provenance = row.provenance;
    if (!provenance) continue;
    const key = `${provenance.packId}@${provenance.version}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()];
}

export function coherentVerseRows(rows: readonly ResourceRow[], verseKey: string, script: QuranScriptStyle): readonly ResourceRow[] {
  return rowsByPack(rows).find((group) => group.length > 0
    && group.every((row) => row.verseKey === verseKey && Boolean(resourceText(row, script)))) ?? [];
}

export function exactLocalPageLines(
  scriptRows: readonly ResourceRow[],
  layoutRows: readonly ResourceRow[],
  page: number,
  verseKey: string,
  script: QuranScriptStyle,
): QuranReadingLine[] | null {
  for (const scriptGroup of rowsByPack(scriptRows)) {
    if (!scriptGroup.some((row) => row.verseKey === verseKey)) continue;
    if (!scriptGroup.every((row) => row.page === page && row.wordKey && row.verseKey && resourceText(row, script))) continue;
    const scriptByWord = new Map(scriptGroup.map((row) => [row.wordKey!, row]));
    if (scriptByWord.size !== scriptGroup.length) continue;

    for (const layoutGroup of rowsByPack(layoutRows)) {
      if (!layoutGroup.some((row) => row.verseKey === verseKey)) continue;
      const linesPerPage = Number(layoutGroup[0]?.provenance?.compatibility?.linesPerPage);
      if (!Number.isSafeInteger(linesPerPage) || linesPerPage < 9 || linesPerPage > 15) continue;
      if (!layoutGroup.every((row) => row.page === page && row.wordKey && row.line && row.line >= 1 && row.line <= linesPerPage)) continue;
      const layoutByWord = new Map(layoutGroup.map((row) => [row.wordKey!, row]));
      if (layoutByWord.size !== layoutGroup.length || layoutByWord.size !== scriptByWord.size) continue;
      if ([...scriptByWord.keys()].some((key) => !layoutByWord.has(key))) continue;

      const grouped = new Map<number, ResourceRow[]>();
      for (const [wordKey, row] of scriptByWord) {
        const line = layoutByWord.get(wordKey)?.line;
        if (!line) continue;
        grouped.set(line, [...(grouped.get(line) ?? []), row]);
      }
      const lineNumbers = [...grouped.keys()].sort((left, right) => left - right);
      if (lineNumbers.length !== linesPerPage || lineNumbers.some((line, index) => line !== index + 1)) continue;
      const lines = lineNumbers.map((line) => {
        const rows = grouped.get(line)!;
        return {
          id: `page-${page}-line-${line}`,
          text: [...rows].sort((left, right) => wordPosition(left) - wordPosition(right))
            .map((row) => resourceText(row, script)!).join(" "),
          active: rows.some((row) => row.verseKey === verseKey),
        };
      });
      if (lines.some((line) => line.active)) return lines;
    }
  }
  return null;
}

export function pageFlowLines(
  verses: readonly { readonly verseKey: string; readonly text: string }[],
  activeVerse: string,
): QuranReadingLine[] {
  const lines: { id: string; words: string[]; verses: Set<string>; length: number }[] = [];
  for (const verse of verses) {
    for (const word of verse.text.split(/\s+/u).filter(Boolean)) {
      let line = lines.at(-1);
      if (!line || (line.length > 0 && line.length + word.length + 1 > 46)) {
        line = { id: `${verse.verseKey}-${lines.length + 1}`, words: [], verses: new Set(), length: 0 };
        lines.push(line);
      }
      line.words.push(word);
      line.verses.add(verse.verseKey);
      line.length += word.length + (line.words.length > 1 ? 1 : 0);
    }
  }
  while (lines.length > 15) {
    const tail = lines.pop()!;
    const previous = lines.at(-1)!;
    previous.words.push(...tail.words);
    for (const key of tail.verses) previous.verses.add(key);
  }
  return lines.map((line) => ({ id: line.id, text: line.words.join(" "), active: line.verses.has(activeVerse) }));
}
