import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../theme";

interface MarkSurahDialogProps {
  visible: boolean;
  surahName: string;
  /** Verses of this surah already in your reading history. */
  readCount?: number;
  totalVerses?: number;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function MarkSurahDialog(props: MarkSurahDialogProps) {
  const { theme } = useTheme();

  useKeyboard((key) => {
    if (!props.visible) return;
    const str = key.sequence || key.name;
    if (str === "y" || str === "Y") {
      props.onConfirm();
    }
    if (str === "n" || str === "N" || key.name === "escape") {
      props.onDismiss();
    }
  });

  if (!props.visible) return null;

  return (
    <box
      position="absolute"
      top="35%"
      left="25%"
      width="50%"
      height={11}
      borderStyle={theme.borderStyleFocused}
      customBorderChars={theme.borderChars}
      borderColor={theme.colors.highlight}
      flexDirection="column"
      padding={1}
      zIndex={100}
      backgroundColor={theme.colors.background}
      title={` ${theme.ornaments.focusIcon} Mark Surah as Read? `}
      titleAlignment="center"
    >
      <box justifyContent="center" marginBottom={1}>
        <text fg={theme.colors.text}>
          {`Mark ${theme.ornaments.headerLeft} ${props.surahName} ${theme.ornaments.headerRight} as fully read?`}
        </text>
      </box>

      <box justifyContent="center">
        <text fg={theme.colors.secondary} attributes={TextAttributes.BOLD}>
          {"  [Y] Yes    [N] No  "}
        </text>
      </box>

      <box justifyContent="center" marginTop={1}>
        <text fg={theme.colors.muted}>
          {props.readCount !== undefined && props.totalVerses
            ? `You've read ${props.readCount} of ${props.totalVerses} verses so far.`
            : "Tracking reading is on, so leaving a surah asks this."}
        </text>
      </box>
      <box justifyContent="center">
        <text fg={theme.colors.muted}>
          {"Yes logs every verse in the surah; No just moves on."}
        </text>
      </box>
    </box>
  );
}
