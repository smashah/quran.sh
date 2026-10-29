import { type ReactNode } from "react";
import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { SurahList } from "./surah-list";
import { useRoute } from "../router";
import { useTheme } from "../theme";
import { useMode } from "../mode";

export interface LayoutProps {
  sidebar?: ReactNode;
  panel?: ReactNode;
  children?: ReactNode;
  status?: ReactNode;
  showSidebar?: boolean;
  showPanel?: boolean;
  sidebarFocused?: boolean;
  panelFocused?: boolean;
  /** Whether reading history is being logged ("Track reading", m). */
  trackingReading?: boolean;
  /** Plain-language name of the focused area, shown in the status bar. */
  focusLabel?: string;
}

const LEGEND: readonly (readonly [string, string])[] = [
  ["?", "Help"],
  ["^P", "Commands"],
  ["Tab", "Area"],
  [":", "Go to"],
  ["/", "Search"],
  ["m", "Track"],
  ["b", "Bookmark"],
  ["p", "Play"],
  ["w", "Tafsir"],
  ["^F", "Fuzzy"],
  ["s", "Side"],
  ["c", "Copy img"],
];
const QUIT: readonly [string, string] = ["q", "Quit"];

function legendWidth(items: readonly (readonly [string, string])[]): number {
  return items.reduce((total, [key, label]) => total + key.length + label.length + 4, 0);
}

export function fitLegend(width: number): (readonly [string, string])[] {
  const chosen: (readonly [string, string])[] = [];
  for (const item of LEGEND) {
    if (legendWidth([...chosen, item, QUIT]) > width) break;
    chosen.push(item);
  }
  return [...chosen, QUIT];
}

export function Layout(props: LayoutProps) {
  const { theme } = useTheme();
  const dimensions = useTerminalDimensions();
  const { mode, resolvedMode } = useMode();
  const { navigate } = useRoute();
  const sidebarVisible = props.showSidebar ?? true;
  const panelVisible = props.showPanel ?? false;
  const sidebarFocused = props.sidebarFocused ?? false;
  const panelFocused = props.panelFocused ?? false;

  const getReaderWidth = () => {
    let width = 100;
    if (sidebarVisible) width -= 25;
    if (panelVisible) width -= 25;
    return `${width}%` as `${number}%`;
  };

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.colors.background}>
      <box flexDirection="row" width="100%" flexGrow={1}>
        {sidebarVisible && (
          <box
            width="25%"
            overflow="hidden"
            borderStyle={sidebarFocused ? theme.borderStyleFocused : theme.borderStyle}
            borderColor={sidebarFocused ? theme.colors.borderFocused : theme.colors.border}
            customBorderChars={theme.borderChars}
            focusedBorderColor={theme.colors.borderFocused}
            title={sidebarFocused ? ` ${theme.ornaments.focusIcon} Surahs ` : " Surahs "}
            titleAlignment="left"
            backgroundColor={theme.colors.background}
          >
            {props.sidebar || <SurahList onSelect={(id) => navigate(`/surah/${id}`)} />}
          </box>
        )}

        <box
          width={getReaderWidth()}
          overflow="hidden"
          flexDirection="column"
          backgroundColor={theme.colors.background}
        >
          {props.children}
        </box>

        {panelVisible && (
          <box
            width="25%"
            overflow="hidden"
            borderStyle={panelFocused ? theme.borderStyleFocused : theme.borderStyle}
            borderColor={panelFocused ? theme.colors.borderFocused : theme.colors.border}
            customBorderChars={theme.borderChars}
            focusedBorderColor={theme.colors.borderFocused}
            title={panelFocused ? ` ${theme.ornaments.focusIcon} Activity ` : " Activity "}
            titleAlignment="left"
            backgroundColor={theme.colors.background}
          >
            {props.panel}
          </box>
        )}
      </box>

      {props.status}

      {/* NC-style keybinding legend: as many hints as fit, with Help first and Quit always last */}
      <box height={1} width="100%" backgroundColor={theme.colors.background} flexDirection="row" overflow="hidden">
        {fitLegend(dimensions.width).map(([key, label]) => (
          <box key={key} flexDirection="row" flexShrink={0}>
            <text bg={theme.colors.highlight} fg={theme.colors.background}>{` ${key} `}</text>
            <text bg={theme.colors.statusBar} fg={theme.colors.text}>{` ${label} `}</text>
          </box>
        ))}
      </box>

      {/* Status bar — dynasty, focused area, reading tracking and colours */}
      <box height={1} width="100%" backgroundColor={theme.colors.statusBar} flexDirection="row" justifyContent="space-between" overflow="hidden">
        <text fg={theme.colors.secondary} flexShrink={1} wrapMode="none">
          {dimensions.width >= 100
            ? ` ${theme.ornaments.focusIcon} ${theme.name} — ${theme.era} ${theme.ornaments.focusIcon}${props.focusLabel ? `  Focus: ${props.focusLabel}` : ""} `
            : ` ${theme.ornaments.focusIcon} ${props.focusLabel ? `Focus: ${props.focusLabel}` : theme.name} `}
        </text>
        <box flexDirection="row" flexShrink={0}>
          <text fg={props.trackingReading ? theme.colors.highlight : theme.colors.muted} attributes={props.trackingReading ? TextAttributes.BOLD : 0}>
            {` Tracking: ${props.trackingReading ? "ON" : "OFF"} (m) `}
          </text>
          <text fg={theme.colors.muted}>
            {`· Colours: ${mode.toUpperCase()}${mode === "auto" ? ` (${resolvedMode})` : ""} (D) `}
          </text>
        </box>
      </box>
    </box>
  );
};
