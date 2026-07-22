/**
 * RTL (Right-to-Left) text processing utilities for Arabic Quran text.
 *
 * Supports multiple rendering strategies because terminals handle Arabic/BiDi
 * text differently.  On first launch the user picks the strategy that looks
 * correct in *their* terminal and it is persisted via preferences.
 *
 * Strategies use `arabic-reshaper` to convert standard Arabic (U+0600 block)
 * to Presentation Forms B (U+FE70 block) which carry pre-shaped contextual
 * forms (initial, medial, final, isolated).
 */
// @ts-ignore — no type declarations
import ArabicReshaper from "arabic-reshaper";

// ---------------------------------------------------------------------------
// Strategy definitions
// ---------------------------------------------------------------------------

/**
 * Every supported RTL rendering strategy.
 * Terminals differ in BiDi support so users pick the one that works.
 */
export const RTL_STRATEGIES = [
  // --- no reshaping ---
  "raw",
  "reversed",
  "stripped",
  "stripped_reversed",

  // --- reshaped (Presentation Forms B) ---
  "reshaped",
  "reshaped_reversed",
  "reshaped_reversed_bidi",
  "reshaped_word_reversed",

  // --- stripped + reshaped ---
  "stripped_reshaped",
  "stripped_reshaped_reversed",
  "stripped_reshaped_reversed_bidi",

  // --- RLO (Right-to-Left Override U+202E … U+202C) ---
  "rlo_raw",
  "rlo_reshaped",
  "stripped_rlo_reshaped",

  // --- RLI (Right-to-Left Isolate  U+2067 … U+2069) ---
  "rli_raw",
  "rli_reshaped",
  "stripped_rli_reshaped",
] as const;

export type RtlStrategy = (typeof RTL_STRATEGIES)[number];
export const DEFAULT_RTL_STRATEGY: RtlStrategy = "reshaped_reversed";

export function isRtlStrategy(value: unknown): value is RtlStrategy {
  return typeof value === "string" && (RTL_STRATEGIES as readonly string[]).includes(value);
}

export function resolveRtlStrategy(value: unknown): RtlStrategy {
  return isRtlStrategy(value) ? value : DEFAULT_RTL_STRATEGY;
}

/** Human-readable labels shown in the calibration dialog. */
export const RTL_STRATEGY_LABELS: Record<RtlStrategy, string> = {
  raw: "Raw (no processing)",
  reversed: "Reversed characters",
  stripped: "Strip diacritics only",
  stripped_reversed: "Strip diacritics + reversed",

  reshaped: "Reshaped (connected glyphs)",
  reshaped_reversed: "Reshaped + reversed",
  reshaped_reversed_bidi: "Reshaped + reversed + BiDi marks",
  reshaped_word_reversed: "Reshaped + word-order reversed",

  stripped_reshaped: "Strip + reshaped",
  stripped_reshaped_reversed: "Strip + reshaped + reversed",
  stripped_reshaped_reversed_bidi: "Strip + reshaped + reversed + BiDi",

  rlo_raw: "RLO override (raw)",
  rlo_reshaped: "RLO override + reshaped",
  stripped_rlo_reshaped: "Strip + RLO override + reshaped",

  rli_raw: "RLI isolate (raw)",
  rli_reshaped: "RLI isolate + reshaped",
  stripped_rli_reshaped: "Strip + RLI isolate + reshaped",
};

// ---------------------------------------------------------------------------
// Active strategy (module-level singleton)
// ---------------------------------------------------------------------------

let activeStrategy: RtlStrategy | null = null;

export function setRtlStrategy(s: RtlStrategy): void {
  activeStrategy = s;
}

export function getRtlStrategy(): RtlStrategy | null {
  return activeStrategy;
}

// ---------------------------------------------------------------------------
// Core transforms
// ---------------------------------------------------------------------------

/** Strip Arabic diacritical marks (tashkeel) from the text. */
function stripDiacritics(text: string): string {
  return text.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u08D3-\u08FF]/g, "");
}

const arabicGraphemeSegmenter = new Intl.Segmenter("ar", { granularity: "grapheme" });

export function splitArabicGraphemes(text: string): string[] {
  const clusters: string[] = [];
  for (const { segment } of arabicGraphemeSegmenter.segment(text)) {
    const previous = clusters.at(-1);
    if (/^[\u06E5\u06E6]/u.test(segment) && previous && !/\s$/u.test(previous)) {
      clusters[clusters.length - 1] = previous + segment;
    } else {
      clusters.push(segment);
    }
  }
  return clusters;
}

/** Reverse visual graphemes while keeping every combining mark on its base. */
function reverse(text: string): string {
  return splitArabicGraphemes(text).reverse().join("");
}

/**
 * Wrap text into lines that fit within `width` columns, then reverse
 * each line individually.  This preserves correct top-to-bottom line
 * order while each line reads RTL.
 *
 * Returns lines joined by `\n`.  Callers that render into OpenTUI
 * **must** split on `\n` and render each line as a separate `<text>`
 * element (OpenTUI cannot handle `\n` inside text content).
 *
 * When `width` is 0 or undefined we fall back to a plain full-string
 * reverse (single-line behaviour, same as before).
 */
export function wrapAndReverse(text: string, width?: number): string {
  if (!width || width <= 0) return reverse(text);

  // 1. Split into visual-width–bounded lines
  const lines = wrapLines(text, width);
  // 2. Reverse each line individually
  return lines.map((l) => reverse(l)).join("\n");
}

/**
 * Measure the visual width of a string.
 * Combining marks (zero-width) are not counted.
 */
export function getVisualWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    if (!isCombiningMark(code) && !isBidiControl(code)) w += 1;
  }
  return w;
}

function isBidiControl(code: number): boolean {
  return code === 0x200e
    || code === 0x200f
    || (code >= 0x202a && code <= 0x202e)
    || (code >= 0x2066 && code <= 0x2069);
}

export function wrapTerminalWords(text: string, maxWidth: number): string[] {
  const width = Math.max(1, Math.floor(maxWidth));
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  let lineWidth = 0;

  for (const word of words) {
    const wordWidth = getVisualWidth(word);
    if (!line) {
      line = word;
      lineWidth = wordWidth;
    } else if (lineWidth + 1 + wordWidth <= width) {
      line += ` ${word}`;
      lineWidth += 1 + wordWidth;
    } else {
      lines.push(line);
      line = word;
      lineWidth = wordWidth;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Break `text` into lines of at most `maxWidth` visual columns.
 * Words are NEVER split across lines — this is critical for Quranic text.
 * If a single word exceeds `maxWidth`, it is placed on its own line.
 */
function wrapLines(text: string, maxWidth: number): string[] {
  return wrapTerminalWords(text, maxWidth);
}

/** Reverse word order (keeps characters within each word as-is). */
function reverseWords(text: string): string {
  return text.split(/\s+/).reverse().join(" ");
}

/** Reshape Arabic text to Presentation Forms B (connected glyphs). */
function reshape(text: string): string {
  return ArabicReshaper.convertArabic(text) as string;
}

/** Wrap text with Right-to-Left Override (U+202E … U+202C). */
function wrapRLO(text: string): string {
  return "\u202E" + text + "\u202C";
}

/** Wrap text with Right-to-Left Isolate (U+2067 … U+2069). */
function wrapRLI(text: string): string {
  return "\u2067" + text + "\u2069";
}

/** Wrap text with Right-to-Left Marks (U+200F). */
function wrapRLM(text: string): string {
  return "\u200F" + text + "\u200F";
}

/**
 * Apply a specific strategy to Arabic text.  Used both by the reader at
 * runtime and by the calibration dialog to preview each strategy.
 */
export function applyStrategy(
  text: string,
  strategy: RtlStrategy,
  width?: number,
): string {
  switch (strategy) {
    // --- no reshaping ---
    case "raw":
      return text;
    case "reversed":
      return wrapAndReverse(text, width);
    case "stripped":
      return stripDiacritics(text);
    case "stripped_reversed":
      return wrapAndReverse(stripDiacritics(text), width);

    // --- reshaped ---
    case "reshaped":
      return reshape(text);
    case "reshaped_reversed":
      return wrapAndReverse(reshape(text), width);
    case "reshaped_reversed_bidi":
      return wrapRLM(wrapAndReverse(reshape(text), width));
    case "reshaped_word_reversed":
      return reverseWords(reshape(text));

    // --- stripped + reshaped ---
    case "stripped_reshaped":
      return reshape(stripDiacritics(text));
    case "stripped_reshaped_reversed":
      return wrapAndReverse(reshape(stripDiacritics(text)), width);
    case "stripped_reshaped_reversed_bidi":
      return wrapRLM(wrapAndReverse(reshape(stripDiacritics(text)), width));

    // --- RLO (Right-to-Left Override) ---
    case "rlo_raw":
      return wrapRLO(text);
    case "rlo_reshaped":
      return wrapRLO(reshape(text));
    case "stripped_rlo_reshaped":
      return wrapRLO(reshape(stripDiacritics(text)));

    // --- RLI (Right-to-Left Isolate) ---
    case "rli_raw":
      return wrapRLI(text);
    case "rli_reshaped":
      return wrapRLI(reshape(text));
    case "stripped_rli_reshaped":
      return wrapRLI(reshape(stripDiacritics(text)));
  }
}

// ---------------------------------------------------------------------------
// Public API (used by reader.tsx)
// ---------------------------------------------------------------------------

/**
 * Process Arabic text for terminal display using the active strategy.
 * Falls back to `reshaped_reversed` if no strategy has been set yet.
 */
export function processArabicText(text: string, width?: number): string {
  return applyStrategy(text, activeStrategy ?? DEFAULT_RTL_STRATEGY, width);
}

// ---------------------------------------------------------------------------
// RTL language detection
// ---------------------------------------------------------------------------

/** ISO 639-1 codes for RTL translation languages supported by quran-json */
const RTL_LANGUAGES = new Set(["ur", "fa", "ar", "he", "ps", "sd", "yi", "ku"]);

/**
 * Whether a given language code is RTL.
 * Used by reader.tsx to decide whether translation text needs shaping.
 */
export function isRtlLanguage(lang: string): boolean {
  return RTL_LANGUAGES.has(lang.toLowerCase());
}

/**
 * Right-align text by padding with spaces on the left.
 */
export function alignRTL(text: string, width: number): string {
  const textWidth = getVisualWidth(text);
  if (textWidth >= width) return text;
  return " ".repeat(width - textWidth) + text;
}

/**
 * Process Arabic verse text and apply zoom spacing.
 * This is the main export used by reader.tsx.
 *
 * @param text - Raw Arabic verse text
 * @param zoom - Zoom level (0-5). Each level adds one space between base
 *               characters, making the Arabic text wider in the terminal.
 */
export function renderArabicVerse(
  text: string,
  zoom: number = 0,
  width?: number,
): string {
  return renderArabicVerseWithStrategy(text, activeStrategy ?? DEFAULT_RTL_STRATEGY, zoom, width);
}

const VISUALLY_REVERSED_WORD_ORDER = new Set<RtlStrategy>([
  "reversed",
  "stripped_reversed",
  "reshaped_reversed",
  "reshaped_reversed_bidi",
  "reshaped_word_reversed",
  "stripped_reshaped_reversed",
  "stripped_reshaped_reversed_bidi",
]);

/** Locate one logical Quran word inside an already rendered RTL verse. */
export function renderedArabicWordRange(
  source: string,
  rendered: string,
  wordPosition: number,
  width?: number,
  strategy: RtlStrategy = activeStrategy ?? DEFAULT_RTL_STRATEGY,
  zoom: number = 0,
): { readonly start: number; readonly end: number } | null {
  if (!Number.isSafeInteger(wordPosition) || wordPosition < 1) return null;
  const sourceLines = width && width > 0 ? wrapTerminalWords(source, width) : [source];
  const renderedLines = rendered.split("\n");
  if (sourceLines.length !== renderedLines.length) return null;
  let nextLogicalPosition = 1;
  let renderedOffset = 0;
  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex++) {
    const sourceWords = sourceLines[lineIndex]!.trim().split(/\s+/u).filter(Boolean);
    const logicalPositions = sourceWords.map(() => nextLogicalPosition++);
    if (VISUALLY_REVERSED_WORD_ORDER.has(strategy)) logicalPositions.reverse();
    const renderedLine = renderedLines[lineIndex]!;
    const matches = zoom <= 0
      ? [...renderedLine.matchAll(/\S+/gu)].map((match) => ({ index: match.index ?? 0, text: match[0] }))
      : zoomedWordRanges(renderedLine, zoom);
    if (matches.length !== logicalPositions.length) return null;
    const visualIndex = logicalPositions.indexOf(wordPosition);
    if (visualIndex >= 0) {
      const match = matches[visualIndex]!;
      const start = renderedOffset + match.index;
      return { start, end: start + match.text.length };
    }
    renderedOffset += renderedLine.length + 1;
  }
  return null;
}

function zoomedWordRanges(renderedLine: string, zoom: number): readonly { index: number; text: string }[] {
  const boundaryWidth = zoom + 1;
  const ranges: { index: number; text: string }[] = [];
  let cursor = 0;
  while (cursor < renderedLine.length) {
    while (renderedLine[cursor] === " ") cursor++;
    if (cursor >= renderedLine.length) break;
    const start = cursor;
    let end = renderedLine.length;
    while (cursor < renderedLine.length) {
      if (renderedLine[cursor] !== " ") { cursor++; continue; }
      const separatorStart = cursor;
      while (renderedLine[cursor] === " ") cursor++;
      if (cursor - separatorStart >= boundaryWidth) {
        end = separatorStart;
        break;
      }
    }
    ranges.push({ index: start, text: renderedLine.slice(start, end) });
  }
  return ranges;
}

export function renderArabicVerseWithStrategy(
  text: string,
  strategy: RtlStrategy,
  zoom: number = 0,
  width?: number,
): string {
  const shaped = width && width > 0
    ? wrapTerminalWords(text, width).map((line) => applyStrategy(line, strategy)).join("\n")
    : applyStrategy(text, strategy, width);
  if (zoom <= 0) return shaped;

  const chars = [...shaped];
  const result: string[] = [];
  const spacer = " ".repeat(zoom);

  for (let i = 0; i < chars.length; i++) {
    result.push(chars[i]!);
    if (
      i < chars.length - 1 &&
      !isCombiningMark(chars[i + 1]!.codePointAt(0)!) &&
      chars[i] !== " "
    ) {
      result.push(spacer);
    }
  }

  return result.join("");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isCombiningMark(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x0610 && code <= 0x061a) ||
    (code >= 0x064b && code <= 0x065f) ||
    (code >= 0x0670 && code <= 0x0670) ||
    (code >= 0x06d6 && code <= 0x06dc) ||
    (code >= 0x06df && code <= 0x06e4) ||
    (code >= 0x06e7 && code <= 0x06e8) ||
    (code >= 0x06ea && code <= 0x06ed) ||
    (code >= 0x08d3 && code <= 0x08ff) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  );
}
