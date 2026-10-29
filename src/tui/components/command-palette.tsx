import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useTheme } from "../theme";

export interface CommandItem {
  key: string;
  label: string;
  description: string;
}

/** Case-insensitive match on label, description and key; every word must match. */
export function filterCommands<T extends CommandItem>(commands: readonly T[], query: string): T[] {
  const words = query.trim().toLocaleLowerCase("en").split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [...commands];
  return commands.filter((command) => {
    const haystack = `${command.label} ${command.description} ${command.key}`.toLocaleLowerCase("en");
    return words.every((word) => haystack.includes(word));
  });
}

interface CommandPaletteProps {
  visible: boolean;
  commands: CommandItem[];
  selectedIndex: number;
  query?: string;
}

export function CommandPalette(props: CommandPaletteProps) {
  const { theme } = useTheme();
  const dimensions = useTerminalDimensions();

  if (!props.visible) return null;

  const width = Math.min(Math.max(40, dimensions.width - 6), 100);
  const left = Math.max(0, Math.floor((dimensions.width - width) / 2));
  const height = Math.max(8, Math.min(dimensions.height - 2, props.commands.length + 7));
  const top = Math.max(0, Math.floor((dimensions.height - height) / 3));
  const rowsVisible = Math.max(1, height - 7);
  const start = Math.max(0, Math.min(
    props.selectedIndex - Math.floor(rowsVisible / 2),
    props.commands.length - rowsVisible,
  ));
  const visible = props.commands.slice(start, start + rowsVisible);
  const keyWidth = 9;
  const labelWidth = Math.min(28, Math.max(16, Math.floor((width - keyWidth) * 0.4)));
  const query = props.query ?? "";

  return (
    <box
      position="absolute"
      top={top}
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
      title={` ${theme.ornaments.focusIcon} Command Palette `}
      titleAlignment="center"
    >
      <box height={1} flexShrink={0} flexDirection="row" marginTop={1}>
        <text fg={theme.colors.secondary} attributes={TextAttributes.BOLD}>{`${theme.ornaments.verseMarker} `}</text>
        <text fg={query ? theme.colors.text : theme.colors.muted}>{query || "Type to filter commands…"}</text>
        <text fg={theme.colors.highlight}>{"▎"}</text>
      </box>
      <box height={1} flexShrink={0} marginBottom={1}>
        <text fg={theme.colors.muted}>
          {props.commands.length === 0
            ? "No commands match"
            : `${props.commands.length} command${props.commands.length === 1 ? "" : "s"}${props.commands.length > rowsVisible ? ` · showing ${start + 1}-${start + visible.length}` : ""}`}
        </text>
      </box>

      <box flexDirection="column" flexGrow={1} overflow="hidden">
        {visible.map((cmd, offset) => {
          const isSelected = start + offset === props.selectedIndex;
          return (
            <box key={`${cmd.label}-${cmd.key}`} flexDirection="row" height={1} flexShrink={0}>
              <text
                fg={isSelected ? theme.colors.highlight : theme.colors.secondary}
                attributes={TextAttributes.BOLD}
                width={keyWidth}
                flexShrink={0}
              >
                {`${isSelected ? `${theme.ornaments.verseMarker} ` : "  "}${cmd.key}`}
              </text>
              <text
                fg={isSelected ? theme.colors.highlight : theme.colors.text}
                attributes={isSelected ? TextAttributes.BOLD : 0}
                width={labelWidth}
                flexShrink={0}
              >
                {cmd.label}
              </text>
              <text fg={theme.colors.muted} flexGrow={1} flexShrink={1} wrapMode="none">
                {cmd.description}
              </text>
            </box>
          );
        })}
      </box>

      <box height={1} flexShrink={0} justifyContent="center">
        <text fg={theme.colors.muted}>
          {"Type to filter · ↑/↓ (or j/k when empty) move · Enter run · Esc close"}
        </text>
      </box>
    </box>
  );
}
