import { TextAttributes } from "@opentui/core";
import { useTheme } from "../theme";

interface HelpDialogProps {
  visible: boolean;
}

export function HelpDialog(props: HelpDialogProps) {
  const { theme } = useTheme();

  const shortcuts = [
    { key: "Tab", desc: "Cycle focus (Sidebar \u2192 Arabic \u2192 Translation \u2192 Translit)" },
    { key: "Shift+Tab", desc: "Cycle sidebar focus (Surah List \u2194 Reading Stats)" },
    { key: "\u2191/\u2193 j/k", desc: "Navigate surahs or verses" },
    { key: "Enter", desc: "Select surah (in Sidebar)" },
    { key: "b", desc: "Toggle bookmark (in Reader)" },
    { key: "c", desc: "Copy current ayah image to clipboard" },
    { key: "a", desc: "Toggle Arabic pane" },
    { key: "t", desc: "Toggle Translation pane" },
    { key: "r", desc: "Toggle Transliteration pane" },
    { key: "l", desc: "Cycle Language" },
    { key: "D", desc: "Cycle light/dark mode" },
    { key: "s", desc: "Toggle Sidebar" },
    { key: "B", desc: "Toggle Activity Panel" },
    { key: "T", desc: "Cycle theme (dynasty/era)" },
    { key: "R", desc: "Add/edit reflection" },
    { key: "1-9", desc: "Jump to cue" },
    { key: "! to (", desc: "Set cue 1-9 (Shift+1-9)" },
    { key: "+/-", desc: "Increase/decrease verse spacing" },
    { key: "A", desc: "Cycle Arabic alignment" },
    { key: "W", desc: "Cycle Arabic width" },
    { key: "F", desc: "Cycle verse flow mode" },
    { key: "/", desc: "Search verses" },
    { key: "?", desc: "Show/hide this help dialog" },
    { key: "ESC", desc: "Dismiss dialog / Clear search" },
    { key: "m", desc: "Toggle Reading/Browsing mode" },
    { key: "Ctrl+F", desc: "Fuzzy search (Arabic, translation & transliteration)" },
    { key: "Ctrl+P", desc: "Command Palette" },
    { key: "I", desc: "Re-index search (via Command Palette)" },
    { key: "C", desc: "Re-calibrate Arabic (via Command Palette)" },
    { key: "q", desc: "Quit application" },
  ];

  if (!props.visible) return null;

  return (
    <box
      position="absolute"
      top="10%"
      left="15%"
      width="70%"
      height="80%"
      borderStyle={theme.borderStyleFocused}
      customBorderChars={theme.borderChars}
      borderColor={theme.colors.header}
      flexDirection="column"
      padding={1}
      zIndex={100}
      backgroundColor={theme.colors.background}
      title={` ${theme.ornaments.focusIcon} Help `}
      titleAlignment="center"
    >
      <box justifyContent="center" marginBottom={1}>
        <text fg={theme.colors.highlight} attributes={TextAttributes.BOLD}>
          {`${theme.ornaments.headerLeft} quran.sh Keyboard Shortcuts ${theme.ornaments.headerRight}`}
        </text>
      </box>

      <box flexDirection="column" flexGrow={1} overflow="hidden">
        {shortcuts.map((s) => (
          <box key={s.key} flexDirection="row">
            <text fg={theme.colors.secondary} attributes={TextAttributes.BOLD} width={16}>
              {`  ${s.key}`}
            </text>
            <text fg={theme.colors.text}>
              {s.desc}
            </text>
          </box>
        ))}
      </box>

      <box justifyContent="center" marginTop={1}>
        <text fg={theme.colors.muted}>
          {`Theme: ${theme.name} (${theme.era}) ${theme.ornaments.sectionMarker} Press T to change`}
        </text>
      </box>
    </box>
  );
};
