import { RootRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import type { TranscriptEntry } from "./coordinator.ts";
import {
  alignRTL,
  DEFAULT_RTL_STRATEGY,
  getVisualWidth,
  renderArabicVerseWithStrategy,
  wrapTerminalWords,
  type RtlStrategy,
} from "../../tui/utils/rtl.ts";

export interface ScrollbackTranscriptWriter {
  append(entry: TranscriptEntry): void;
}

export interface ScrollbackTranscriptOptions {
  readonly rtlStrategy?: RtlStrategy;
}

const VISUALLY_REVERSED_STRATEGIES = new Set<RtlStrategy>([
  "reversed",
  "stripped_reversed",
  "reshaped_reversed",
  "reshaped_reversed_bidi",
  "reshaped_word_reversed",
  "stripped_reshaped_reversed",
  "stripped_reshaped_reversed_bidi",
]);

export function formatTranscriptEntryForScrollback(
  entry: TranscriptEntry,
  width: number,
  rtlStrategy: RtlStrategy = DEFAULT_RTL_STRATEGY,
): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  if (entry.kind === "revisit") return wrapTerminalWords(`↩ ${entry.verseKey} revisited`, safeWidth);

  const ornateMarker = `﴿${entry.verse.verseKey}﴾`;
  const marker = getVisualWidth(ornateMarker) <= safeWidth
    ? ornateMarker
    : getVisualWidth(entry.verse.verseKey) <= safeWidth ? entry.verse.verseKey : "";
  const markerWidth = getVisualWidth(marker);
  const sharesLineWithMarker = markerWidth > 0 && safeWidth >= markerWidth + 3;
  const arabicWidth = sharesLineWithMarker ? safeWidth - markerWidth - 2 : safeWidth;
  const arabicLines = renderArabicVerseWithStrategy(entry.verse.arabic, rtlStrategy, 0, arabicWidth).split("\n");
  const visualArabic = arabicLines.map((line, index) => alignRTL(
    index === arabicLines.length - 1 && sharesLineWithMarker
      ? VISUALLY_REVERSED_STRATEGIES.has(rtlStrategy)
        ? `${marker}  ${line}`
        : `${line}  ${marker}`
      : line,
    safeWidth,
  ));
  const lines = [...visualArabic];
  if (marker && !sharesLineWithMarker) lines.push(alignRTL(marker, safeWidth));
  if (entry.verse.translation) lines.push(...wrapTerminalWords(entry.verse.translation, safeWidth));
  if (entry.verse.transliteration) lines.push(...wrapTerminalWords(entry.verse.transliteration, safeWidth));
  if (entry.verse.attribution) lines.push(...wrapTerminalWords(`— ${entry.verse.attribution}`, safeWidth));
  return lines;
}

let transcriptRenderableId = 0;

export function createOpenTuiScrollbackWriter(
  renderer: CliRenderer,
  options: ScrollbackTranscriptOptions = {},
): ScrollbackTranscriptWriter {
  return {
    append(entry) {
      renderer.writeToScrollback(({ renderContext, width }) => {
        const lines = formatTranscriptEntryForScrollback(entry, width, options.rtlStrategy);
        const root = new RootRenderable(renderContext);
        root.flexDirection = "column";
        const id = transcriptRenderableId++;
        for (const [index, content] of lines.entries()) {
          root.add(new TextRenderable(renderContext, {
            id: `transcript-${id}-${index}`,
            content,
            width,
            height: 1,
            wrapMode: "none",
          }));
        }
        root.resize(width, Math.max(1, lines.length));
        root.calculateLayout();
        return {
          root,
          width,
          height: Math.max(1, lines.length),
          startOnNewLine: true,
          trailingNewline: true,
        };
      });
    },
  };
}
