import type { CommandItem } from "./components/command-palette.tsx";

// Scope: "global" keys work from any pane, "reader" keys need a reader pane,
// and "palette" commands have no direct key (the key column stays empty).
const COMMAND_DEFINITIONS = [
  ["go-to", ":", "Go to Verse", "Jump to 2:255, a surah number or a surah name", "global"],
  ["search", "/", "Search", "Search verses (filters surahs when the sidebar is focused)", "global"],
  ["fuzzy-search", "Ctrl+F", "Fuzzy Search", "Search Arabic, translation and transliteration", "global"],
  ["toggle-reading", "m", "Track Reading", "Turn reading history and streak tracking on/off", "global"],
  ["toggle-bookmark", "b", "Toggle Bookmark", "Bookmark the current verse", "global"],
  ["add-reflection", "R", "Add Reflection", "Add/edit reflection for current verse", "global"],
  ["open-tafsir", "w", "Open Tafsir", "Read attributed commentary for the current ayah", "global"],
  ["choose-tafsir", "W", "Choose Tafsir", "Choose a saved English commentary resource", "global"],
  ["toggle-playback", "p", "Play Recitation", "Follow or stop synchronized recitation", "global"],
  ["copy-image", "c", "Copy Ayah Image", "Fetch and copy the current verse PNG", "global"],
  ["toggle-arabic", "a", "Toggle Arabic", "Show/hide Arabic pane", "global"],
  ["toggle-translation", "t", "Toggle Translation", "Show/hide Translation pane", "global"],
  ["toggle-transliteration", "r", "Toggle Transliteration", "Show/hide Transliteration pane", "global"],
  ["toggle-image", "i", "Toggle Arabic Image", "Show/hide the online ayah image in the Arabic pane", "global"],
  ["cycle-language", "l", "Cycle Language", "Switch translation language", "global"],
  ["toggle-sidebar", "s", "Toggle Sidebar", "Show/hide surah sidebar", "global"],
  ["toggle-panel", "B", "Toggle Activity Panel", "Show/hide bookmarks, cues and reflections", "global"],
  ["cycle-focus", "Tab", "Next Area", "Move focus: Surahs, Reading stats, Reader, Activity", "global"],
  ["previous-focus", "Shift+Tab", "Previous Area", "Move focus back one area", "global"],
  ["next-reader-pane", "", "Next Reader Pane", "Focus the next Arabic, Translation or Transliteration pane", "palette"],
  ["zoom-in", "+", "More Arabic Spacing", "Add space between Arabic words", "global"],
  ["zoom-out", "-", "Less Arabic Spacing", "Remove space between Arabic words", "global"],
  ["cycle-align", "A", "Cycle Arabic Alignment", "Switch right, center and left alignment", "global"],
  ["cycle-width", "G", "Cycle Arabic Width", "Switch Arabic pane content width", "global"],
  ["cycle-flow", "F", "Cycle Arabic Flow", "Switch verse-by-verse and continuous flow", "global"],
  ["cycle-theme", "T", "Cycle Theme", "Switch dynasty theme", "global"],
  ["cycle-mode", "D", "Cycle Light/Dark", "Switch auto, dark and light colours", "global"],
  ["help", "?", "Help", "Show keyboard shortcuts", "global"],
  ["reset-tracking", "X", "Reset Tracking", "Delete reading data by period (asks first)", "global"],
  ["reindex", "", "Re-index Search", "Rebuild fuzzy search index", "palette"],
  ["calibrate", "", "Re-calibrate Arabic", "Re-run Arabic rendering calibration", "palette"],
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
