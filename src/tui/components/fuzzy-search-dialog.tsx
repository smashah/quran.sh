import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useState, useCallback, useEffect } from "react";
import { useTheme } from "../theme";
import { fuzzySearch, isIndexReady, ensureSearcherAsync } from "../../data/fuzzy-search";
import type { FuzzySearchResult } from "../../data/fuzzy-search";

interface FuzzySearchDialogProps {
  visible: boolean;
  onSelect: (surahId: number, verseId: number) => void;
  onDismiss: () => void;
  language?: string;
}

const MAX_VISIBLE = 10;

export function FuzzySearchDialog(props: FuzzySearchDialogProps) {
  const { theme } = useTheme();
  const [input, setInput] = useState("");
  const [results, setResults] = useState<FuzzySearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const language = props.language ?? "en";
  const [indexReady, setIndexReady] = useState(isIndexReady(language));

  useEffect(() => {
    setIndexReady(isIndexReady(language));
    setResults([]);
    setSelectedIndex(0);
  }, [language]);

  // Trigger async index build when dialog opens
  useEffect(() => {
    if (props.visible && !indexReady) {
      ensureSearcherAsync(language).then(() => setIndexReady(true));
    }
  }, [props.visible, indexReady, language]);

  const runSearch = useCallback((query: string) => {
    if (query.trim().length === 0) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }
    if (!isIndexReady(language)) return;
    const hits = fuzzySearch(query, 50, language);
    setResults(hits);
    setSelectedIndex(0);
  }, [language]);

  useEffect(() => {
    if (indexReady) runSearch(input);
  }, [indexReady, input, runSearch]);

  useKeyboard((key) => {
    if (!props.visible) return;
    key.preventDefault();
    key.stopPropagation();
    const str = key.sequence || key.name;

    if (key.name === "escape") {
      setInput("");
      setResults([]);
      setSelectedIndex(0);
      props.onDismiss();
      return;
    }

    if (key.name === "return") {
      const hit = results[selectedIndex];
      if (hit) {
        setInput("");
        setResults([]);
        setSelectedIndex(0);
        props.onSelect(hit.verse.surahId, hit.verse.verseId);
      }
      return;
    }

    if (key.name === "down" || (key.ctrl && key.name === "n")) {
      setSelectedIndex((prev) => Math.min(prev + 1, Math.max(0, results.length - 1)));
      return;
    }
    if (key.name === "up" || (key.ctrl && key.name === "p")) {
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (key.name === "backspace") {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    if (str && str.length === 1 && !key.ctrl && !key.meta) {
      setInput((prev) => prev + str);
      return;
    }
  });

  if (!props.visible) return null;

  // Compute visible window
  const halfWindow = Math.floor(MAX_VISIBLE / 2);
  let windowStart = Math.max(0, selectedIndex - halfWindow);
  const windowEnd = Math.min(results.length, windowStart + MAX_VISIBLE);
  if (windowEnd - windowStart < MAX_VISIBLE) {
    windowStart = Math.max(0, windowEnd - MAX_VISIBLE);
  }
  const visibleResults = results.slice(windowStart, windowEnd);

  return (
    <box
      position="absolute"
      top="10%"
      left="15%"
      width="70%"
      height="75%"
      borderStyle={theme.borderStyleFocused}
      customBorderChars={theme.borderChars}
      borderColor={theme.colors.highlight}
      flexDirection="column"
      padding={1}
      zIndex={100}
      backgroundColor={theme.colors.background}
      title={` ${theme.ornaments.focusIcon} Fuzzy Search `}
      titleAlignment="center"
    >
      {/* Search input */}
      <box marginBottom={1} flexDirection="row">
        <text fg={theme.colors.secondary} attributes={TextAttributes.BOLD}>
          {`${theme.ornaments.verseMarker} `}
        </text>
        <text fg={theme.colors.text}>
          {input.length > 0 ? input : ""}
        </text>
        <text fg={!indexReady ? theme.colors.highlight : theme.colors.muted}>
          {!indexReady ? "Indexing verses..." : input.length === 0 ? "Type to search..." : ""}
        </text>
        {indexReady && <text fg={theme.colors.highlight}>{"▎"}</text>}
      </box>

      {/* Result count */}
      {results.length > 0 && (
        <box marginBottom={1}>
          <text fg={theme.colors.muted}>
            {`${results.length} result${results.length !== 1 ? "s" : ""}`}
            {results.length > MAX_VISIBLE
              ? ` (showing ${windowStart + 1}–${windowEnd})`
              : ""}
          </text>
        </box>
      )}

      {/* No results */}
      {input.length > 0 && results.length === 0 && (
        <box justifyContent="center" marginTop={2}>
          <text fg={theme.colors.muted}>No matches found</text>
        </box>
      )}

      {/* Results list — key forces full re-render on scroll to prevent artifacts */}
      <box key={`results-${windowStart}-${selectedIndex}`} flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleResults.map((hit, i) => {
          const globalIndex = windowStart + i;
          const isSelected = globalIndex === selectedIndex;
          const v = hit.verse;
          const ref = `[${v.reference}]`;
          const surah = v.surahTransliteration;
          const refCol = 10;
          const surahCol = 16;

          return (
            <box key={v.reference} flexDirection="row" marginTop={1} padding={1}>
              <text
                fg={isSelected ? theme.colors.highlight : theme.colors.secondary}
                attributes={isSelected ? TextAttributes.BOLD : 0}
                width={refCol}
              >
                {isSelected ? `${theme.ornaments.verseMarker} ` : "  "}
                {ref}
              </text>
              <text
                fg={isSelected ? theme.colors.highlight : theme.colors.text}
                attributes={isSelected ? TextAttributes.BOLD : 0}
                width={surahCol}
              >
                {surah}
              </text>
              <text
                fg={isSelected ? theme.colors.text : theme.colors.muted}
                flexGrow={1}
              >
                {v.translation}
              </text>
            </box>
          );
        })}
      </box>

      {/* Footer */}
      <box justifyContent="center" marginTop={1}>
        <text fg={theme.colors.muted}>
          {"↑/↓ navigate  Enter select  Esc cancel"}
        </text>
      </box>
    </box>
  );
}
