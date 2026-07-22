import type { CommandItem } from "./components/command-palette.tsx";

const COMMAND_DEFINITIONS = [
  ["toggle-arabic", "a", "Toggle Arabic", "Show/hide Arabic pane", "global"],
  ["toggle-image", "i", "Toggle Arabic Image", "Show/hide ayah Braille image render", "global"],
  ["toggle-translation", "t", "Toggle Translation", "Show/hide Translation pane", "global"],
  ["toggle-transliteration", "r", "Toggle Transliteration", "Show/hide Transliteration pane", "global"],
  ["cycle-language", "l", "Cycle Language", "Switch translation language", "global"],
  ["toggle-reading", "m", "Toggle Reading Mode", "Switch browsing/reading mode", "reader"],
  ["cycle-mode", "D", "Cycle Mode", "Switch light/dark mode", "global"],
  ["cycle-theme", "T", "Cycle Theme", "Switch dynasty theme", "global"],
  ["toggle-sidebar", "s", "Toggle Sidebar", "Show/hide surah sidebar", "global"],
  ["toggle-panel", "B", "Toggle Panel", "Show/hide activity panel", "global"],
  ["zoom-in", "+", "Zoom In Arabic", "Increase Arabic text size", "global"],
  ["zoom-out", "-", "Zoom Out Arabic", "Decrease Arabic text size", "global"],
  ["cycle-align", "A", "Cycle Arabic Alignment", "Switch right, center and left alignment", "global"],
  ["cycle-width", "G", "Cycle Arabic Width", "Switch Arabic pane content width", "global"],
  ["cycle-flow", "F", "Cycle Arabic Flow", "Switch verse and continuous flow", "global"],
  ["toggle-bookmark", "b", "Toggle Bookmark", "Bookmark current verse", "reader"],
  ["copy-image", "c", "Copy Ayah Image", "Fetch and copy the current verse PNG", "reader"],
  ["add-reflection", "R", "Add Reflection", "Add/edit reflection for current verse", "global"],
  ["cycle-focus", "Tab", "Cycle Focus", "Move focus between visible panes", "global"],
  ["search", "/", "Search", "Search verses", "global"],
  ["fuzzy-search", "Ctrl+F", "Fuzzy Search", "Search Arabic, translation and transliteration", "global"],
  ["open-tafsir", "w", "Open Tafsir", "Read attributed commentary for the current ayah", "global"],
  ["choose-tafsir", "W", "Choose Tafsir", "Choose a saved English commentary resource", "global"],
  ["toggle-playback", "p", "Play Recitation", "Follow or stop synchronized recitation", "global"],
  ["help", "?", "Help", "Show keyboard shortcuts", "global"],
  ["reset-tracking", "X", "Reset Tracking", "Delete reading data by period", "global"],
  ["reindex", "I", "Re-index Search", "Rebuild fuzzy search index", "palette"],
  ["calibrate", "C", "Re-calibrate Arabic", "Re-run Arabic rendering calibration", "palette"],
  ["quit", "q", "Quit", "Exit application", "global"],
] as const;

export type AppCommandId = (typeof COMMAND_DEFINITIONS)[number][0];
export type CommandActions = Record<AppCommandId, () => void>;

export interface AppCommand extends CommandItem {
  id: AppCommandId;
  scope: "global" | "reader" | "palette";
  action: () => void;
}

export function buildAppCommands(actions: CommandActions): AppCommand[] {
  return COMMAND_DEFINITIONS.map(([id, key, label, description, scope]) => ({
    id,
    key,
    label,
    description,
    scope,
    action: actions[id],
  }));
}
