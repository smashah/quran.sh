import { ChoiceDialog } from "./choice-dialog.tsx";

interface ImageWarningDialogProps {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ImageWarningDialog({ visible, onConfirm, onCancel }: ImageWarningDialogProps) {
  return (
    <ChoiceDialog
      visible={visible}
      title="Use online ayah images?"
      description={[
        "The image reader requests the active ayah PNG from the documented Al Quran Cloud / Islamic Network CDN and renders it as terminal Braille cells.",
        "The CDN receives your IP address. quran.sh sends no account, notes, history, or telemetry.",
        "Images are size- and dimension-limited, cached only in memory, and unloaded when the view closes.",
      ]}
      choices={[{
        key: "y",
        label: "Use online images",
        detail: "You can zoom out the terminal or use +/- if the calligraphy is too large.",
        action: onConfirm,
      }, {
        key: "n",
        label: "Keep terminal text",
        detail: "Continue reading at the same ayah without a network request.",
        action: onCancel,
      }]}
      onDismiss={onCancel}
    />
  );
}
