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

/** Reverse character order. */
function reverse(text: string): string {
  return [...text].reverse().join("");
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
 * Measure the visual width of a string in terminal columns.
 * Combining marks and zero-width characters are not counted.
 * This is the single source of truth for width calculation.
 */
function visualWidth(str: string): number {
  return getVisualWidth(str);
}

/**
 * Break `text` into lines of at most `maxWidth` visual columns.
 * Words are NEVER split across lines — this is critical for Quranic text.
 * If a single word exceeds `maxWidth`, it is placed on its own line.
 */
function wrapLines(text: string, maxWidth: number): string[] {
  const words = text.split(/(\s+)/); // keep whitespace tokens
  const lines: string[] = [];
  let line = "";
  let lineWidth = 0;

  for (const token of words) {
    const tw = visualWidth(token);

    // Pure whitespace token
    if (/^\s+$/.test(token)) {
      // Only add space if line already has content and it fits
      if (line.length > 0 && lineWidth + tw <= maxWidth) {
        line += token;
        lineWidth += tw;
      }
      continue;
    }

    // Word token
    if (line.length === 0) {
      // Start of a new line — always accept the word
      line = token;
      lineWidth = tw;
    } else if (lineWidth + 1 + tw <= maxWidth) {
      // Fits on current line (with a space separator)
      line += " " + token;
      lineWidth += 1 + tw;
    } else {
      // Doesn't fit — push current line and start new one
      lines.push(line);
      line = token;
      lineWidth = tw;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
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
  return applyStrategy(text, activeStrategy ?? "reshaped_reversed", width);
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
  const shaped = processArabicText(text, width);
  if (zoom <= 0) return shaped;

  const chars = [...shaped];
  const result: string[] = [];
  const spacer = " ".repeat(zoom);

  for (let i = 0; i < chars.length; i++) {
    result.push(chars[i]!);
    if (
      i < chars.length - 1 &&
      !isZeroWidth(chars[i + 1]!.codePointAt(0)!) &&
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

/**
 * Compute the visual width of text in terminal columns.
 *
 * Correctly handles:
 * - Arabic combining marks (tashkeel/diacritics) — zero width
 * - General combining marks (U+0300–036F) — zero width
 * - Zero-width joiners and non-joiners (U+200C, U+200D) — zero width
 * - BiDi control characters (U+200E–200F, U+202A–202E, U+2066–2069) — zero width
 * - Soft hyphens (U+00AD) — zero width
 * - Arabic tatweel/kashida (U+0640) — width 1
 *
 * Exported so that reader.tsx can compute alignment padding accurately.
 */
export function getVisualWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (isZeroWidth(code)) continue;
    width += 1;
  }
  return width;
}

/**
 * Whether a codepoint occupies zero terminal columns.
 * Includes combining marks and invisible formatting characters.
 */
export function isZeroWidth(code: number): boolean {
  return isCombiningMark(code) || isInvisibleFormat(code);
}

/**
 * Whether a codepoint is a combining mark (rendered on the preceding base character).
 *
 * Covers all combining marks found in the Uthmani Quran text from quran-json:
 * - U+064B–065F: Arabic tashkeel (fatha, kasra, damma, shadda, sukun, etc.)
 * - U+0670: Superscript alef
 * - U+06D6–06DC: Quranic annotation signs (small high ligatures, stop signs)
 * - U+06DF–06E4: Small high characters (rounded zero, meem, etc.)
 * - U+06E7–06E8: Small high yeh/noon
 * - U+06EA–06ED: Small low/high signs
 * - U+0610–061A: Quranic signs above (not in quran-json but safe to include)
 * - U+0300–036F: General combining diacriticals
 * - U+08D3–08FF: Extended Arabic combining marks
 * - U+FE20–FE2F: Combining half marks
 */
function isCombiningMark(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x0610 && code <= 0x061a) ||
    (code >= 0x064b && code <= 0x065f) ||
    (code === 0x0670) ||
    (code >= 0x06d6 && code <= 0x06dc) ||
    (code >= 0x06df && code <= 0x06e4) ||
    (code >= 0x06e7 && code <= 0x06e8) ||
    (code >= 0x06ea && code <= 0x06ed) ||
    (code >= 0x08d3 && code <= 0x08ff) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  );
}

/**
 * Invisible formatting characters that occupy zero terminal columns.
 */
function isInvisibleFormat(code: number): boolean {
  return (
    code === 0x00ad ||                         // Soft hyphen
    code === 0x200b ||                         // Zero-width space
    code === 0x200c ||                         // Zero-width non-joiner
    code === 0x200d ||                         // Zero-width joiner
    code === 0x200e || code === 0x200f ||       // LRM / RLM
    (code >= 0x202a && code <= 0x202e) ||       // LRE, RLE, PDF, LRO, RLO
    code === 0x2060 ||                         // Word joiner
    (code >= 0x2066 && code <= 0x2069) ||       // LRI, RLI, FSI, PDI
    code === 0xfeff                            // BOM / ZWNBSP
  );
}
