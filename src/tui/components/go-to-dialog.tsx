import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState } from "react";
import { parseQuranReference } from "../../data/reference.ts";
import { useTheme } from "../theme";
import { wrapDialogLine } from "./choice-dialog.tsx";

interface GoToDialogProps {
  readonly visible: boolean;
  readonly onSelect: (surahId: number, verseId: number) => void;
  readonly onDismiss: () => void;
}

/** Jump straight to "2:255", "kahf 10", "yasin" or "the cow". */
export function GoToDialog(props: GoToDialogProps) {
  const { theme } = useTheme();
  const dimensions = useTerminalDimensions();
  const [input, setInput] = useState("");

  useEffect(() => {
    if (!props.visible) setInput("");
  }, [props.visible]);

  useKeyboard((key) => {
    if (!props.visible) return;
    key.preventDefault();
    key.stopPropagation();
    if (key.name === "escape") {
      props.onDismiss();
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      const parsed = parseQuranReference(input);
      if (parsed.ok) props.onSelect(parsed.surahId, parsed.verseId ?? 1);
      return;
    }
    if (key.name === "backspace") {
      setInput((value) => value.slice(0, -1));
      return;
    }
    const str = key.sequence;
    if (str && str.length === 1 && !key.ctrl && !key.meta && str >= " ") setInput((value) => value + str);
  });

  if (!props.visible) return null;

  const parsed = input.trim() ? parseQuranReference(input) : null;
  const width = Math.min(Math.max(36, dimensions.width - 8), 72);
  const left = Math.max(0, Math.floor((dimensions.width - width) / 2));
  const status = parsed === null
    ? ["Examples: 2:255 · 18 · kahf 10 · yasin · the cow"]
    : parsed.ok
      ? [`Enter opens ${parsed.label}`]
      : wrapDialogLine(parsed.message, width - 4);

  return (
    <box
      position="absolute"
      top={Math.max(1, Math.floor(dimensions.height / 3) - 2)}
      left={left}
      width={width}
      height={6 + status.length}
      borderStyle={theme.borderStyleFocused}
      customBorderChars={theme.borderChars}
      borderColor={theme.colors.highlight}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      zIndex={190}
      backgroundColor={theme.colors.background}
      title={` ${theme.ornaments.focusIcon} Go to `}
      titleAlignment="center"
    >
      <box height={1} flexShrink={0} flexDirection="row" marginTop={1}>
        <text fg={theme.colors.secondary} attributes={TextAttributes.BOLD}>{": "}</text>
        <text fg={theme.colors.text}>{input}</text>
        <text fg={theme.colors.highlight}>{"▎"}</text>
      </box>
      <box flexDirection="column" flexShrink={0} marginTop={1}>
        {status.map((line, index) => (
          <text key={index} fg={parsed && !parsed.ok ? theme.colors.highlight : theme.colors.muted}>{line}</text>
        ))}
      </box>
      <box height={1} flexShrink={0}>
        <text fg={theme.colors.muted}>{"Enter go · Esc cancel"}</text>
      </box>
    </box>
  );
}
