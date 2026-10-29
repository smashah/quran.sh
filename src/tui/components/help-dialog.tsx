import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef } from "react";
import { useTheme } from "../theme";

export interface HelpSection {
  readonly title: string;
  readonly rows: readonly (readonly [key: string, description: string])[];
}

/** Dashboard keys, grouped by task. Shared keys match the immersive reader. */
export const DASHBOARD_HELP_SECTIONS: readonly HelpSection[] = [
  {
    title: "Move around",
    rows: [
      ["Tab / Shift+Tab", "Next / previous area: Surahs, Reading stats, Reader, Activity"],
      ["↑/↓  j/k", "Move through surahs, verses, search results or list items"],
      ["Enter", "Open the selected surah, search result or Activity item"],
      [":", "Go to a verse or surah (2:255, kahf 10, yasin)"],
      ["1-9", "Jump to a saved cue"],
      ["s / B", "Show or hide the surah sidebar / Activity panel"],
    ],
  },
  {
    title: "Search",
    rows: [
      ["/", "Search verses (in the sidebar, / filters the surah list)"],
      ["Ctrl+F", "Fuzzy search Arabic, translation and transliteration"],
      ["Esc", "Close a dialog or clear search results"],
    ],
  },
  {
    title: "Study and history",
    rows: [
      ["b", "Bookmark the current verse"],
      ["! to (", "Save the current verse as cue 1-9 (Shift+1-9)"],
      ["R", "Add or edit a reflection on the current verse"],
      ["m", "Track reading on/off (logs the verses you read for streaks and stats)"],
      ["X", "Delete reading history for a period (asks first)"],
      ["w / W", "Open tafsir for the current verse / choose a saved tafsir"],
      ["p", "Play or stop synchronized recitation"],
      ["c", "Copy the current ayah image to the clipboard"],
    ],
  },
  {
    title: "Panes and display",
    rows: [
      ["a / t / r", "Show or hide the Arabic / Translation / Transliteration pane"],
      ["i", "Show or hide the online ayah image (Braille) in the Arabic pane"],
      ["l", "Next translation language"],
      ["+ / -", "More / less space between Arabic words (zooms the image when it is shown)"],
      ["A / G / F", "Arabic alignment / width / verse or continuous flow"],
      ["T / D", "Next dynasty theme / light, dark or auto colours"],
      ["C  0  arrows", "With the image focused: clear image caches / reset / pan"],
    ],
  },
  {
    title: "In lists",
    rows: [
      ["h/l  ←/→", "Switch Activity tabs (Bookmarks, Cues, Reflections)"],
      ["←/→", "Change the Reading stats period when it is focused"],
    ],
  },
  {
    title: "General",
    rows: [
      ["Ctrl+P", "Command palette: every action, searchable by name"],
      ["? or h", "Show or hide this help (h works when the reader is focused)"],
      ["q", "Quit"],
    ],
  },
];

interface HelpDialogProps {
  readonly visible: boolean;
  readonly onClose?: () => void;
  readonly title?: string;
  readonly sections?: readonly HelpSection[];
  readonly footer?: string;
}

export function HelpDialog(props: HelpDialogProps) {
  const { theme } = useTheme();
  const dimensions = useTerminalDimensions();
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const sections = props.sections ?? DASHBOARD_HELP_SECTIONS;

  useEffect(() => {
    if (props.visible) scrollRef.current?.scrollTo(0);
  }, [props.visible]);

  useKeyboard((key) => {
    if (!props.visible) return;
    const str = key.sequence || key.name;
    key.preventDefault();
    key.stopPropagation();
    if (key.name === "escape" || str === "q" || str === "?" || str === "h") {
      props.onClose?.();
      return;
    }
    const page = Math.max(1, Math.floor(dimensions.height * 0.6));
    if (key.name === "down" || str === "j") scrollRef.current?.scrollBy(1);
    else if (key.name === "up" || str === "k") scrollRef.current?.scrollBy(-1);
    else if (key.name === "pagedown" || key.name === "space" || str === " ") scrollRef.current?.scrollBy(page);
    else if (key.name === "pageup") scrollRef.current?.scrollBy(-page);
  });

  if (!props.visible) return null;

  const width = Math.min(Math.max(40, dimensions.width - 4), 96);
  const left = Math.max(0, Math.floor((dimensions.width - width) / 2));
  const height = Math.max(8, dimensions.height - 2);
  const keyWidth = Math.min(19, Math.max(12, Math.floor(width * 0.22)));

  return (
    <box
      position="absolute"
      top={1}
      left={left}
      width={width}
      height={height}
      borderStyle={theme.borderStyleFocused}
      customBorderChars={theme.borderChars}
      borderColor={theme.colors.header}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      zIndex={180}
      backgroundColor={theme.colors.background}
      title={` ${theme.ornaments.focusIcon} ${props.title ?? "quran.sh keys"} `}
      titleAlignment="center"
    >
      <scrollbox ref={scrollRef} flexGrow={1} width="100%" scrollY={true} scrollbarOptions={{ visible: true }}>
        {sections.map((section) => (
          <box key={section.title} flexDirection="column" flexShrink={0} marginTop={1}>
            <text fg={theme.colors.highlight} attributes={TextAttributes.BOLD} flexShrink={0}>
              {`${theme.ornaments.sectionMarker} ${section.title}`}
            </text>
            {section.rows.map(([keys, description]) => (
              <box key={`${section.title}-${keys}`} flexDirection="row" flexShrink={0}>
                <text fg={theme.colors.secondary} attributes={TextAttributes.BOLD} width={keyWidth} flexShrink={0}>
                  {`  ${keys}`}
                </text>
                <text fg={theme.colors.text} flexGrow={1} flexShrink={1} wrapMode="word">
                  {description}
                </text>
              </box>
            ))}
          </box>
        ))}
      </scrollbox>
      <box height={1} flexShrink={0} justifyContent="center">
        <text fg={theme.colors.muted}>
          {props.footer ?? "j/k scroll · Space next page · ? or Esc closes"}
        </text>
      </box>
    </box>
  );
}
