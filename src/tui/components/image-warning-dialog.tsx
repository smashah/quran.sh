import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../theme";

interface ImageWarningDialogProps {
  visible: boolean;
  onConfirm: () => void;
}

export function ImageWarningDialog({ visible, onConfirm }: ImageWarningDialogProps) {
  const { theme } = useTheme();

  useKeyboard((key) => {
    if (!visible) return;
    if (key.name === "return" || key.name === "enter") {
      onConfirm();
    }
  });

  if (!visible) return null;

  return (
    <box
      position="absolute"
      top="35%"
      left="15%"
      width="70%"
      height={13}
      borderStyle={theme.borderStyleFocused}
      customBorderChars={theme.borderChars}
      borderColor={theme.colors.highlight}
      flexDirection="column"
      padding={1}
      zIndex={100}
      backgroundColor={theme.colors.background}
      title={` ${theme.ornaments.focusIcon} High Definition Rendering `}
      titleAlignment="center"
    >
      <box flexDirection="column" width="100%" justifyContent="center" alignItems="center">
        <text fg={theme.colors.text} marginBottom={1}>
          You are about to switch the Arabic pane to the Image Reader.
        </text>
        <text fg={theme.colors.muted} marginBottom={1}>
          This rendering engine maps Arabic calligraphy to physical terminal cells using a high-density Braille matrix (8x resolution).
        </text>
        <text fg={theme.colors.muted} marginBottom={1}>
          Verse PNGs are fetched from surahquran.com when needed and cached in memory for this session. The request reveals your IP address to that service.
        </text>
        <text fg={theme.colors.secondary} attributes={TextAttributes.BOLD} marginBottom={1}>
          TIP: If the rendering looks huge or illegible, you must ZOOM OUT your terminal window
        </text>
        <text fg={theme.colors.secondary} attributes={TextAttributes.BOLD} marginBottom={1}>
          (Cmd/Ctrl + Minus) until the calligraphy becomes clear.
        </text>

        <text fg={theme.colors.text} marginTop={1} attributes={TextAttributes.BOLD}>
          [ENTER] OK, I got it
        </text>
      </box>
    </box>
  );
}
