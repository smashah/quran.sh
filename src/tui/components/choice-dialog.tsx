import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

export interface DialogChoice {
  readonly key: string;
  readonly label: string;
  readonly detail?: string;
  readonly action: () => void;
}

export interface ChoiceDialogProps {
  readonly visible: boolean;
  readonly title: string;
  readonly description: readonly string[];
  readonly choices: readonly DialogChoice[];
  readonly onDismiss: () => void;
}

export function choiceForKey(
  choices: readonly DialogChoice[],
  key: { readonly sequence?: string; readonly name?: string },
): DialogChoice | undefined {
  if (key.name === "return" || key.name === "enter" || key.sequence === "\r") return choices[0];
  const pressed = (key.sequence || key.name || "").toLowerCase();
  return choices.find((choice) => choice.key.toLowerCase() === pressed);
}

export function handleDialogKey(
  choices: readonly DialogChoice[],
  key: Parameters<Parameters<typeof useKeyboard>[0]>[0],
  onDismiss: () => void,
): void {
  key.preventDefault();
  key.stopPropagation();
  if (key.name === "escape") {
    onDismiss();
    return;
  }
  choiceForKey(choices, key)?.action();
}

export function wrapDialogLine(value: string, width: number): string[] {
  if (value.length <= width) return [value];
  const output: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/)) {
    if (!line) {
      line = word;
      continue;
    }
    if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      output.push(line);
      line = word;
    }
  }
  if (line) output.push(line);
  return output;
}

export function ChoiceDialog(props: ChoiceDialogProps) {
  const dimensions = useTerminalDimensions();
  useKeyboard((key) => {
    if (!props.visible) return;
    handleDialogKey(props.choices, key, props.onDismiss);
  });

  if (!props.visible) return null;
  const lineWidth = Math.max(28, Math.floor(dimensions.width * 0.9) - 6);
  const description = props.description.flatMap((line) => wrapDialogLine(line, lineWidth));
  const choices = props.choices.flatMap((choice, index) => [
    { text: `[${choice.key.toUpperCase()}] ${choice.label}${index === 0 ? " · Enter" : ""}`, primary: index === 0 },
    ...choice.detail ? wrapDialogLine(choice.detail, lineWidth - 4).map((line) => ({ text: `    ${line}`, primary: false })) : [],
  ]);
  const height = Math.min(dimensions.height - 2, 7 + description.length + choices.length);
  const top = Math.max(1, Math.floor((dimensions.height - height) / 2));

  return (
    <box
      position="absolute"
      top={top}
      left="5%"
      width="90%"
      height={height}
      borderStyle="double"
      borderColor="#d8b45d"
      flexDirection="column"
      padding={1}
      zIndex={200}
      backgroundColor="#081017"
      title={` ${props.title} `}
      titleAlignment="center"
    >
      {description.map((line, index) => <text key={`description-${index}`} fg="#c4cfcc">{line}</text>)}
      <box height={1} />
      {choices.map((choice, index) => (
        <text key={`choice-${index}`} fg={choice.primary ? "#d8b45d" : "#60747b"} attributes={choice.primary ? TextAttributes.BOLD : undefined}>
          {choice.text}
        </text>
      ))}
      <text fg="#52646b">Esc cancels</text>
    </box>
  );
}
