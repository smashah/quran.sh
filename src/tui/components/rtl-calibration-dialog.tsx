import { useState, useRef } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useTheme } from "../theme";
import {
  RTL_STRATEGIES,
  RTL_STRATEGY_LABELS,
  applyStrategy,
  type RtlStrategy,
} from "../utils/rtl";

const PREVIEW_TEXT = "بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ ٱللَّهُ لَآ إِلَٰهَ إِلَّا هُوَ ٱلۡحَيُّ ٱلۡقَيُّومُ لَا تَأۡخُذُهُۥ سِنَةٞ وَلَا نَوۡمٞ";

/**
 * Lines reserved around the list: padding (4), header (2), three instruction
 * blocks (5), key hint (2), more-above/below markers (2) and footer (2).
 */
const CHROME_LINES = 17;
const RECOMMENDED_INDEX = 5; // reshaped_reversed

interface RtlCalibrationDialogProps {
  onDone: (strategy: RtlStrategy) => void;
}

export function RtlCalibrationDialog(props: RtlCalibrationDialogProps) {
  const { theme } = useTheme();
  const { height: rows, width: cols } = useTerminalDimensions();
  const [selectedIndex, setSelectedIndex] = useState(RECOMMENDED_INDEX);
  const windowStartRef = useRef(0);

  useKeyboard((key) => {
    const str = key.sequence || key.name;
    if (key.name === "up" || str === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.name === "down" || str === "j") {
      setSelectedIndex((i) => Math.min(RTL_STRATEGIES.length - 1, i + 1));
    } else if (key.name === "return") {
      props.onDone(RTL_STRATEGIES[selectedIndex]!);
    } else if (key.name === "escape") {
      props.onDone(RTL_STRATEGIES[RECOMMENDED_INDEX]!);
    }
  });

  // Each item is its label row plus however many lines the preview wraps to.
  const previewWidth = Math.max(20, cols - 12);
  const itemHeight = 1 + Math.max(1, applyStrategy(PREVIEW_TEXT, RTL_STRATEGIES[RECOMMENDED_INDEX]!, previewWidth).split("\n").length);
  // Stable window: only shift when selection escapes the visible range
  const maxVisible = Math.max(3, Math.floor((rows - CHROME_LINES) / itemHeight));
  const total = RTL_STRATEGIES.length;
  let ws = windowStartRef.current;
  if (selectedIndex < ws) ws = selectedIndex;                             // scrolled above
  else if (selectedIndex >= ws + maxVisible) ws = selectedIndex - maxVisible + 1; // scrolled below
  ws = Math.max(0, Math.min(ws, total - maxVisible));                     // clamp
  windowStartRef.current = ws;

  const visibleItems = RTL_STRATEGIES.slice(ws, ws + maxVisible);
  const aboveCount = ws;
  const belowCount = total - (ws + visibleItems.length);

  return (
    <box
      position="absolute"
      top="0%"
      left="0%"
      width="100%"
      height="100%"
      flexDirection="column"
      padding={2}
      zIndex={200}
      backgroundColor={theme.colors.background}
    >
      {/* Header */}
      <box justifyContent="center" marginBottom={1}>
        <text fg={theme.colors.highlight} attributes={TextAttributes.BOLD}>
          {`${theme.ornaments.headerLeft} Arabic Rendering Calibration ${theme.ornaments.headerRight}`}
        </text>
      </box>

      <box justifyContent="center">
        <text fg={theme.colors.muted}>
          {"Terminals draw Arabic differently, so quran.sh asks once."}
        </text>
      </box>
      <box justifyContent="center" marginBottom={1}>
        <text fg={theme.colors.muted}>
          {"Pick the sample where the letters join up and the words read right-to-left."}
        </text>
      </box>
      <box justifyContent="center" marginBottom={1}>
        <text fg={theme.colors.muted}>
          {"If a sample wraps onto a second line, check that line too. Not sure? Keep the recommended one."}
        </text>
      </box>
      <box justifyContent="center" marginBottom={1}>
        <text fg={theme.colors.secondary}>
          {"↑/↓ choose · Enter confirm · Esc use the recommended option"}
        </text>
      </box>

      {/* "More above" indicator */}
      {aboveCount > 0 && (
        <box justifyContent="center">
          <text fg={theme.colors.muted}>
            {`▲ ${aboveCount} more above`}
          </text>
        </box>
      )}

      {/* Strategy list (windowed) */}
      <box flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleItems.map((strategy) => {
          const idx = RTL_STRATEGIES.indexOf(strategy);
          const isSelected = idx === selectedIndex;
          const label = `${RTL_STRATEGY_LABELS[strategy]}${idx === RECOMMENDED_INDEX ? "  (recommended)" : ""}`;
          const preview = applyStrategy(PREVIEW_TEXT, strategy, previewWidth);
          const marker = isSelected ? theme.ornaments.verseMarker : " ";
          const labelColor = isSelected
            ? theme.colors.highlight
            : theme.colors.secondary;
          const textColor = isSelected
            ? theme.colors.arabic
            : theme.colors.muted;
          const bgColor = isSelected
            ? theme.colors.statusBar
            : theme.colors.background;

          return (
            <box
              key={strategy}
              flexDirection="column"
              flexShrink={0}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={bgColor}
            >
              <box flexDirection="row">
                <text
                  fg={labelColor}
                  attributes={TextAttributes.BOLD}
                  width={4}
                >
                  {`${marker}${String(idx + 1).padStart(2)}`}
                </text>
                <text
                  fg={labelColor}
                  attributes={TextAttributes.BOLD}
                >
                  {` ${label}`}
                </text>
              </box>
              <box paddingLeft={4} flexDirection="column">
                {preview.split("\n").map((line, li) => (
                  <text
                    key={li}
                    fg={textColor}
                    attributes={TextAttributes.BOLD}
                  >
                    {line}
                  </text>
                ))}
              </box>
            </box>
          );
        })}
      </box>

      {/* "More below" indicator */}
      {belowCount > 0 && (
        <box justifyContent="center">
          <text fg={theme.colors.muted}>
            {`▼ ${belowCount} more below`}
          </text>
        </box>
      )}

      {/* Footer */}
      <box justifyContent="center" marginTop={1}>
        <text fg={theme.colors.muted}>
          {`${selectedIndex + 1}/${RTL_STRATEGIES.length} — Change it later: Ctrl+P, then "Re-calibrate Arabic"`}
        </text>
      </box>
    </box>
  );
}
