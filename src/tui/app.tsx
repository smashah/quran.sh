import { useKeyboard } from "@opentui/react";
import { useState, useEffect, useCallback, useRef } from "react";
import { Layout } from "./components/layout";
import { RouteProvider } from "./router";
import { SurahList } from "./components/surah-list";
import { StreakChart } from "./components/streak-chart";
import { ReadingStats } from "./components/reading-stats";
import { Reader } from "./components/reader";
import { HelpDialog } from "./components/help-dialog";
import { Panel } from "./components/panel";
import type { PanelTab } from "./components/panel";
import { ReflectionDialog } from "./components/reflection-dialog";
import { MarkSurahDialog } from "./components/mark-surah-dialog";
import { ResetTrackingDialog } from "./components/reset-tracking-dialog";
import { FuzzySearchDialog } from "./components/fuzzy-search-dialog";
import { reindex } from "../data/fuzzy-search";
import { CommandPalette } from "./components/command-palette";
import { RtlCalibrationDialog } from "./components/rtl-calibration-dialog";
import { setRtlStrategy, getRtlStrategy, type RtlStrategy } from "./utils/rtl";
import { copyAyahImage } from "./utils/clipboard";
import { ImageWarningDialog } from "./components/image-warning-dialog";
import type { CommandItem } from "./components/command-palette";
import { toggleBookmark, getBookmarkedAyahs, getAllBookmarks } from "../data/bookmarks";
import type { Bookmark } from "../data/bookmarks";
import { setCue, getCue, getAllCues } from "../data/cues";
import type { Cue } from "../data/cues";
import { getAllReflections, addReflection, getReflection } from "../data/reflections";
import type { Reflection } from "../data/reflections";
import { getSurah, search, LANGUAGES } from "../data/quran";
import { logVerse } from "../data/log";
import { logSurah, deleteReadingLog, getCompletedSurahIds, getReadVerseIds } from "../data/log";
import type { ResetPeriod } from "../data/log";
import { getPreference, setPreference } from "../data/preferences";
import type { VerseRef } from "../data/quran";
import { ThemeProvider, useTheme } from "./theme";
import type { Theme } from "./theme";
import { ModeProvider, useMode } from "./mode";

export { useTheme };
export type { Theme };

export type FocusablePane = "sidebar" | "arabic" | "translation" | "transliteration" | "panel";

export type ArabicAlign = "right" | "center" | "left";
export type ArabicWidth = "100%" | "80%" | "60%";
export type ArabicFlow = "verse" | "continuous";

// ---------------------------------------------------------------------------
// Load saved preferences (runs once at module level, before any render)
// ---------------------------------------------------------------------------
function loadPref(key: string, fallback: string): string {
  try { return getPreference(key) ?? fallback; } catch { return fallback; }
}

const savedPrefs = {
  selectedSurahId: Number(loadPref("selectedSurahId", "1")),
  currentVerseId: Number(loadPref("currentVerseId", "1")),
  showArabic: loadPref("showArabic", "true") === "true",
  showArabicImage: loadPref("showArabicImage", "false") === "true",
  showTranslation: loadPref("showTranslation", "true") === "true",
  showTransliteration: loadPref("showTransliteration", "false") === "true",
  language: loadPref("language", "en"),
  arabicAlign: loadPref("arabicAlign", "right") as ArabicAlign,
  arabicWidth: loadPref("arabicWidth", "100%") as ArabicWidth,
  arabicFlow: loadPref("arabicFlow", "verse") as ArabicFlow,
  arabicZoom: Number(loadPref("arabicZoom", "0")),
  showSidebar: loadPref("showSidebar", "true") === "true",
  showPanel: loadPref("showPanel", "false") === "true",
  readingMode: loadPref("readingMode", "false") === "true",
  rtlStrategy: loadPref("rtlStrategy", "") as RtlStrategy | "",
  hasSeenImageWarning: loadPref("hasSeenImageWarning", "false") === "true",
};

// Apply saved RTL strategy immediately (before any render)
if (savedPrefs.rtlStrategy) {
  setRtlStrategy(savedPrefs.rtlStrategy as RtlStrategy);
}

function AppContent() {
  const { cycleTheme } = useTheme();
  const { cycleMode } = useMode();

  const [selectedSurahId, setSelectedSurahId] = useState(savedPrefs.selectedSurahId);
  const [focusedPanel, setFocusedPanel] = useState<FocusablePane>("sidebar");
  const [sidebarSubFocus, setSidebarSubFocus] = useState<"surahList" | "stats">("surahList");
  const [surahSearchFocused, setSurahSearchFocused] = useState(false);
  const [currentVerseId, setCurrentVerseId] = useState(savedPrefs.currentVerseId);
  const [bookmarkedAyahs, setBookmarkedAyahs] = useState<Set<number>>(new Set());
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<VerseRef[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [showSidebar, setShowSidebar] = useState(savedPrefs.showSidebar);
  const [showPanel, setShowPanel] = useState(savedPrefs.showPanel);
  const [showPalette, setShowPalette] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [showReflectionDialog, setShowReflectionDialog] = useState(false);
  const [reflectionInput, setReflectionInput] = useState("");
  const [arabicZoom, setArabicZoom] = useState(savedPrefs.arabicZoom);
  const [arabicAlign, setArabicAlign] = useState<ArabicAlign>(savedPrefs.arabicAlign);
  const [arabicWidth, setArabicWidth] = useState<ArabicWidth>(savedPrefs.arabicWidth);
  const [arabicFlow, setArabicFlow] = useState<ArabicFlow>(savedPrefs.arabicFlow);

  const [showArabic, setShowArabic] = useState(savedPrefs.showArabic);
  const [showArabicImage, setShowArabicImage] = useState(savedPrefs.showArabicImage);
  const [showTranslation, setShowTranslation] = useState(savedPrefs.showTranslation);
  const [showTransliteration, setShowTransliteration] = useState(savedPrefs.showTransliteration);
  const [language, setLanguage] = useState(savedPrefs.language);
  const [flashMessage, setFlashMessage] = useState("");
  const [readingMode, setReadingMode] = useState(savedPrefs.readingMode);
  const [showMarkSurahDialog, setShowMarkSurahDialog] = useState(false);
  const [pendingSurahChange, setPendingSurahChange] = useState<{ fromId: number; toId: number } | null>(null);
  // Track surahs already marked as read this session to avoid duplicate prompts (issue #5)
  const markedSurahsRef = useRef<Set<number>>(new Set());
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [showFuzzySearch, setShowFuzzySearch] = useState(false);
  const [showCalibration, setShowCalibration] = useState(!savedPrefs.rtlStrategy);
  const [completedSurahIds, setCompletedSurahIds] = useState<Set<number>>(new Set());
  const [readVerseIds, setReadVerseIds] = useState<Set<number>>(new Set());
  const [hasSeenImageWarning, setHasSeenImageWarning] = useState(savedPrefs.hasSeenImageWarning);
  const [showImageWarningDialog, setShowImageWarningDialog] = useState(false);

  // Persist settings whenever they change
  useEffect(() => {
    try {
      setPreference("selectedSurahId", String(selectedSurahId));
      setPreference("currentVerseId", String(currentVerseId));
      setPreference("showArabic", String(showArabic));
      setPreference("showArabicImage", String(showArabicImage));
      setPreference("showTranslation", String(showTranslation));
      setPreference("showTransliteration", String(showTransliteration));
      setPreference("language", language);
      setPreference("arabicAlign", arabicAlign);
      setPreference("arabicWidth", arabicWidth);
      setPreference("arabicFlow", arabicFlow);
      setPreference("arabicZoom", String(arabicZoom));
      setPreference("showSidebar", String(showSidebar));
      setPreference("showPanel", String(showPanel));
      setPreference("readingMode", String(readingMode));
      setPreference("hasSeenImageWarning", String(hasSeenImageWarning));
    } catch { /* DB may not be available in tests */ }
  }, [selectedSurahId, currentVerseId, showArabic, showArabicImage, showTranslation, showTransliteration, language, arabicAlign, arabicWidth, arabicFlow, arabicZoom, showSidebar, showPanel, readingMode, hasSeenImageWarning]);

  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFlash = useCallback((msg: string) => {
    setFlashMessage(msg);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashMessage(""), 2000);
  }, []);

  // Cleanup flash timer on unmount
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  const [panelTab, setPanelTab] = useState<PanelTab>("bookmarks");
  const [panelIndex, setPanelIndex] = useState(0);
  const [allBookmarks, setAllBookmarks] = useState<Bookmark[]>([]);
  const [allCues, setAllCues] = useState<Cue[]>([]);
  const [allReflections, setAllReflections] = useState<Reflection[]>([]);

  // Command palette: actionable items with their labels and actions
  interface PaletteCommand extends CommandItem {
    action: () => void;
  }

  const refreshBookmarks = useCallback(() => {
    try {
      setBookmarkedAyahs(getBookmarkedAyahs(selectedSurahId));
      setAllBookmarks(getAllBookmarks());
    } catch {
      // DB may not be available in tests
    }
  }, [selectedSurahId]);

  const refreshPanelData = useCallback(() => {
    try {
      setAllBookmarks(getAllBookmarks());
      setAllCues(getAllCues());
      setAllReflections(getAllReflections());
    } catch { /* DB */ }
  }, []);

  const refreshCompletionData = useCallback(() => {
    try {
      setCompletedSurahIds(getCompletedSurahIds());
      setReadVerseIds(getReadVerseIds(selectedSurahId));
    } catch { /* DB */ }
  }, [selectedSurahId]);

  const isReaderPane = (p: FocusablePane) => p === "arabic" || p === "translation" || p === "transliteration";

  const cycleFocus = useCallback(() => {
    const panes: FocusablePane[] = [];
    if (showSidebar) panes.push("sidebar");
    panes.push("arabic");
    if (showTranslation) panes.push("translation");
    if (showTransliteration) panes.push("transliteration");
    if (showPanel) panes.push("panel");

    const idx = panes.indexOf(focusedPanel);
    const next = panes[(idx + 1) % panes.length]!;
    setFocusedPanel(next);
  }, [showSidebar, showTranslation, showTransliteration, showPanel, focusedPanel]);

  // True when any modal/overlay is open — used to disable focus on child components
  const anyModalOpen = showPalette || showReflectionDialog || showHelp || isSearchMode || showMarkSurahDialog || showResetDialog || showFuzzySearch || showCalibration || showImageWarningDialog;

  // We use refs to access latest state inside the keyboard handler
  // (avoids stale closures without needing to list every state var as dep)
  const sessionStartRef = useRef(new Date().toISOString());
  const stateRef = useRef({
    selectedSurahId, currentVerseId, focusedPanel, isSearchMode, searchInput,
    searchResults, showHelp, showSidebar, showPanel, showPalette, paletteIndex,
    showReflectionDialog, reflectionInput, showArabic, showArabicImage, showTranslation, showTransliteration,
    language, panelTab, panelIndex, allBookmarks, allCues, allReflections, anyModalOpen,
    arabicAlign, arabicWidth, arabicFlow, readingMode, hasSeenImageWarning, showImageWarningDialog,
  });
  stateRef.current = {
    selectedSurahId, currentVerseId, focusedPanel, isSearchMode, searchInput,
    searchResults, showHelp, showSidebar, showPanel, showPalette, paletteIndex,
    showReflectionDialog, reflectionInput, showArabic, showArabicImage, showTranslation, showTransliteration,
    language, panelTab, panelIndex, allBookmarks, allCues, allReflections, anyModalOpen,
    arabicAlign, arabicWidth, arabicFlow, readingMode, hasSeenImageWarning, showImageWarningDialog,
  };

  const paletteCommands: PaletteCommand[] = [
    { key: "a", label: "Toggle Arabic", description: "Show/hide Arabic pane", action: () => setShowArabic((prev) => !prev) },
    { key: "i", label: "Toggle Arabic Image", description: "Show/hide ayah image render", action: () => {
      if (!stateRef.current.hasSeenImageWarning) {
        setShowImageWarningDialog(true);
      } else {
        setShowArabicImage((prev) => !prev);
      }
    } },
    { key: "t", label: "Toggle Translation", description: "Show/hide Translation pane", action: () => setShowTranslation((prev) => !prev) },
    { key: "r", label: "Toggle Transliteration", description: "Show/hide Transliteration pane", action: () => setShowTransliteration((prev) => !prev) },
    {
      key: "l",
      label: "Cycle Language",
      description: "Switch translation language",
      action: () => {
        const s = stateRef.current;
        const idx = LANGUAGES.indexOf(s.language as any);
        if (idx !== -1) setLanguage(LANGUAGES[(idx + 1) % LANGUAGES.length]!);
      },
    },
    { key: "m", label: "Toggle Reading Mode", description: "Switch browsing/reading mode", action: () => {
      setReadingMode(prev => !prev);
      showFlash(stateRef.current.readingMode ? "📋 Browsing mode" : "📖 Reading mode");
    } },
    { key: "D", label: "Cycle Mode", description: "Switch light/dark mode", action: () => cycleMode() },
    { key: "T", label: "Cycle Theme", description: "Switch dynasty theme", action: () => cycleTheme() },
    {
      key: "s",
      label: "Toggle Sidebar",
      description: "Show/hide surah sidebar",
      action: () => {
        const s = stateRef.current;
        const wasVisible = s.showSidebar;
        setShowSidebar((prev) => !prev);
        if (wasVisible && s.focusedPanel === "sidebar") setFocusedPanel("arabic");
        if (!wasVisible) setFocusedPanel("sidebar");
      },
    },
    {
      key: "B",
      label: "Toggle Panel",
      description: "Show/hide activity panel",
      action: () => {
        const s = stateRef.current;
        const wasVisible = s.showPanel;
        setShowPanel((prev) => !prev);
        if (wasVisible && s.focusedPanel === "panel") setFocusedPanel("arabic");
        if (!wasVisible) {
          refreshPanelData();
          setFocusedPanel("panel");
        }
      },
    },
    { key: "+", label: "Zoom In Arabic", description: "Increase Arabic text size", action: () => setArabicZoom((prev) => Math.min(prev + 1, 5)) },
    { key: "-", label: "Zoom Out Arabic", description: "Decrease Arabic text size", action: () => setArabicZoom((prev) => Math.max(prev - 1, 0)) },
    {
      key: "b",
      label: "Toggle Bookmark",
      description: "Bookmark current verse",
      action: () => {
        const s = stateRef.current;
        const verseRef = `${s.selectedSurahId}:${s.currentVerseId}`;
        try {
          toggleBookmark(s.selectedSurahId, s.currentVerseId, verseRef);
          refreshBookmarks();
          if (s.showPanel) refreshPanelData();
        } catch {
          /* DB may not be available */
        }
      },
    },
    {
      key: "c",
      label: "Copy Ayah Image",
      description: "Copy current verse image to clipboard (surahquran.com)",
      action: () => {
        const s = stateRef.current;
        showFlash("Fetching ayah image…");
        copyAyahImage(s.selectedSurahId, s.currentVerseId)
          .then(() => showFlash(`Copied ${s.selectedSurahId}:${s.currentVerseId} image ✓`))
          .catch((e: Error) => showFlash(`Copy failed: ${e.message}`));
      },
    },
    {
      key: "R",
      label: "Add Reflection",
      description: "Add/edit reflection for current verse",
      action: () => {
        const s = stateRef.current;
        try {
          const existing = getReflection(s.selectedSurahId, s.currentVerseId);
          setReflectionInput(existing ? existing.note : "");
          setShowReflectionDialog(true);
        } catch {
          /* DB */
        }
      },
    },
    { key: "Tab", label: "Cycle Focus", description: "Move focus between panes", action: () => cycleFocus() },
    {
      key: "/",
      label: "Search",
      description: "Search verses",
      action: () => {
        setIsSearchMode(true);
        setSearchInput("");
        setFocusedPanel("arabic");
      },
    },
    { key: "Ctrl+F", label: "Fuzzy Search", description: "Fuzzy search across Arabic, translation & transliteration", action: () => setShowFuzzySearch(true) },
    { key: "?", label: "Help", description: "Show keyboard shortcuts", action: () => setShowHelp(true) },
    { key: "X", label: "Reset Tracking", description: "Delete reading data by period", action: () => setShowResetDialog(true) },
    { key: "I", label: "Re-index Search", description: "Rebuild fuzzy search index", action: () => {
      showFlash("Re-indexing…");
      reindex().then(() => showFlash("Search index rebuilt ✓"));
    } },
    { key: "C", label: "Re-calibrate Arabic", description: "Re-run Arabic rendering calibration", action: () => setShowCalibration(true) },
    { key: "q", label: "Quit", description: "Exit application", action: () => process.exit(0) },
  ];

  useKeyboard((key) => {
    const s = stateRef.current;
    // Ctrl+P: toggle command palette
    if (key.ctrl && key.name === "p") {
      setShowPalette((prev) => !prev);
      setPaletteIndex(0);
      return;
    }

    // Ctrl+F: toggle fuzzy search dialog
    if (key.ctrl && key.name === "f") {
      setShowFuzzySearch((prev) => !prev);
      return;
    }

    const str = key.sequence || key.name;

    if (s.showPalette) {
      if (key.name === "escape") {
        setShowPalette(false);
        return;
      }
      if (str === "j" || key.name === "down") {
        setPaletteIndex((prev) => (prev + 1) % paletteCommands.length);
        return;
      }
      if (str === "k" || key.name === "up") {
        setPaletteIndex((prev) => (prev - 1 + paletteCommands.length) % paletteCommands.length);
        return;
      }
      if (key.name === "return") {
        const cmd = paletteCommands[s.paletteIndex];
        if (cmd) {
          cmd.action();
          setShowPalette(false);
        }
        return;
      }
      return;
    }

    if (s.showReflectionDialog) {
      if (key.name === "escape") {
        setShowReflectionDialog(false);
        return;
      }
      if (key.name === "return") {
        const verseRef = `${s.selectedSurahId}:${s.currentVerseId}`;
        try {
          addReflection(s.selectedSurahId, s.currentVerseId, verseRef, s.reflectionInput);
          setShowReflectionDialog(false);
          refreshPanelData();
          showFlash("Reflection saved");
        } catch {
          /* DB */
        }
        return;
      }
      if (key.name === "backspace") {
        setReflectionInput((prev) => prev.slice(0, -1));
        return;
      }
      if (str && str.length === 1 && !key.ctrl && !key.meta) {
        setReflectionInput((prev) => prev + str);
        return;
      }
      return;
    }

    if (s.showHelp) {
      if (key.name === 'escape' || key.name === 'q' || str === '?') {
        setShowHelp(false);
      }
      return;
    }

    // MarkSurahDialog has its own useKeyboard for y/n/escape;
    // we just need the main handler to stop processing further.
    if (showMarkSurahDialog) {
      return;
    }

    // ResetTrackingDialog has its own useKeyboard handler.
    if (showResetDialog) {
      return;
    }

    // FuzzySearchDialog has its own useKeyboard handler.
    if (showFuzzySearch) {
      return;
    }

    if (s.isSearchMode) {
      if (key.name === 'escape') {
        setIsSearchMode(false);
        setSearchInput("");
        setSearchResults([]);
        setSearchQuery("");
        return;
      }
      if (key.name === 'return') {
        const query = s.searchInput;
        if (query.trim().length > 0) {
          const results = search(query);
          setSearchResults(results);
          setSearchQuery(query);
        }
        setIsSearchMode(false);
        return;
      }
      if (key.name === 'backspace') {
        setSearchInput(prev => prev.slice(0, -1));
        return;
      }
      if (str && str.length === 1 && !key.ctrl && !key.meta) {
        setSearchInput(prev => prev + str);
        return;
      }
      return;
    }

    // --- Beyond this point: global shortcuts ---
    const sidebarActive = s.focusedPanel === "sidebar";

    if (key.name === 'q') {
      process.exit(0);
    }

    if (str === '?') {
      setShowHelp(true);
      return;
    }

    // When sidebar is focused AND the surah search input is active,
    // block everything except Tab/Shift+Tab so the <input> can type freely.
    // When sidebar is focused but search is NOT active, allow global shortcuts
    // to pass through (the <select> only uses up/down/enter internally).
    if (sidebarActive && surahSearchFocused) {
      if (key.name === 'tab' && key.shift) {
        setSidebarSubFocus((prev) => prev === "surahList" ? "stats" : "surahList");
        return;
      }
      if (key.name === 'tab') {
        setSidebarSubFocus("surahList");
        cycleFocus();
      }
      if (key.name === 'escape') {
        setSurahSearchFocused(false);
      }
      return;
    }

    // Sidebar focused but search NOT active — allow Tab navigation
    if (sidebarActive) {
      if (key.name === 'tab' && key.shift) {
        setSidebarSubFocus((prev) => prev === "surahList" ? "stats" : "surahList");
        return;
      }
      if (key.name === 'tab') {
        setSidebarSubFocus("surahList");
        cycleFocus();
        return;
      }
      // Fall through to global shortcuts below
    }

    if (s.focusedPanel === "panel") {
      const tabs: PanelTab[] = ["bookmarks", "cues", "reflections"];
      const items = s.panelTab === "bookmarks" ? s.allBookmarks :
                    s.panelTab === "cues" ? s.allCues : s.allReflections;

      if (key.name === "left" || str === "h") {
        const idx = tabs.indexOf(s.panelTab);
        setPanelTab(tabs[(idx - 1 + tabs.length) % tabs.length]!);
        setPanelIndex(0);
        return;
      }
      if (key.name === "right" || str === "l") {
        const idx = tabs.indexOf(s.panelTab);
        setPanelTab(tabs[(idx + 1) % tabs.length]!);
        setPanelIndex(0);
        return;
      }
      if (str === "j" || key.name === "down") {
        setPanelIndex((prev) => Math.min(prev + 1, Math.max(0, items.length - 1)));
        return;
      }
      if (str === "k" || key.name === "up") {
        setPanelIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (key.name === "return") {
        const item = items[s.panelIndex];
        if (item) {
          setSelectedSurahId(item.surah);
          setCurrentVerseId(item.ayah);
          refreshBookmarks();

          if (s.panelTab === "reflections") {
            setReflectionInput((item as Reflection).note);
            setShowReflectionDialog(true);
          }
        }
        return;
      }
    }

    if (str === 'a') {
      setShowArabic(prev => !prev);
      return;
    }
    if (str === 'i') {
      if (!s.hasSeenImageWarning) {
        setShowImageWarningDialog(true);
      } else {
        setShowArabicImage(prev => !prev);
      }
      return;
    }
    if (str === 't') {
      setShowTranslation(prev => !prev);
      return;
    }
    if (str === 'r') {
      setShowTransliteration(prev => !prev);
      return;
    }
    if (str === 'l') {
      const idx = LANGUAGES.indexOf(s.language as any);
      if (idx !== -1) {
        const next = LANGUAGES[(idx + 1) % LANGUAGES.length]!;
        setLanguage(next);
      }
      return;
    }

    if (str === 'A') {
      const aligns: ArabicAlign[] = ["right", "center", "left"];
      const idx = aligns.indexOf(s.arabicAlign);
      const next = aligns[(idx + 1) % aligns.length]!;
      setArabicAlign(next);
      showFlash(`Arabic align: ${next}`);
      return;
    }
    if (str === 'W') {
      const widths: ArabicWidth[] = ["100%", "80%", "60%"];
      const idx = widths.indexOf(s.arabicWidth);
      const next = widths[(idx + 1) % widths.length]!;
      setArabicWidth(next);
      showFlash(`Arabic width: ${next}`);
      return;
    }
    if (str === 'F') {
      const flows: ArabicFlow[] = ["verse", "continuous"];
      const idx = flows.indexOf(s.arabicFlow);
      const next = flows[(idx + 1) % flows.length]!;
      setArabicFlow(next);
      showFlash(`Arabic flow: ${next}`);
      return;
    }

    if (str === 'T') {
      cycleTheme();
      return;
    }

    if (str === 'D') {
      cycleMode();
      return;
    }

    if (str === 's') {
      const wasVisible = s.showSidebar;
      setShowSidebar(prev => !prev);
      if (wasVisible && s.focusedPanel === "sidebar") {
        setFocusedPanel("arabic");
      }
      if (!wasVisible) {
        setFocusedPanel("sidebar");
      }
      return;
    }

    if (str === 'B') {
      const wasVisible = s.showPanel;
      setShowPanel(prev => !prev);
      if (wasVisible && s.focusedPanel === "panel") {
        setFocusedPanel("arabic");
      }
      if (!wasVisible) {
        refreshPanelData();
        setFocusedPanel("panel");
      }
      return;
    }

    if (str === "R") {
      try {
        const existing = getReflection(s.selectedSurahId, s.currentVerseId);
        setReflectionInput(existing ? existing.note : "");
        setShowReflectionDialog(true);
      } catch {
        /* DB */
      }
      return;
    }

    if (str === "X") {
      setShowResetDialog(true);
      return;
    }

    if (str === '+' || str === '=') {
      setArabicZoom(prev => Math.min(prev + 1, 5));
      return;
    }
    if (str === '-') {
      setArabicZoom(prev => Math.max(prev - 1, 0));
      return;
    }

    if (key.name === 'tab') {
      cycleFocus();
      return;
    }

    if (str === '/') {
      setIsSearchMode(true);
      setSearchInput("");
      setFocusedPanel("arabic");
      return;
    }

    if (key.name === 'escape') {
      if (s.searchResults.length > 0) {
        setSearchResults([]);
        setSearchQuery("");
      }
      return;
    }

    if (isReaderPane(s.focusedPanel)) {
      const cueSetSymbols: Record<string, number> = {
        '!': 1, '@': 2, '#': 3, '$': 4, '%': 5, '^': 6, '&': 7, '*': 8, '(': 9
      };
      const cueJumpKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

      if (str && cueSetSymbols[str]) {
        const slot = cueSetSymbols[str]!;
        const verseRef = `${s.selectedSurahId}:${s.currentVerseId}`;
        try {
          setCue(slot, s.selectedSurahId, s.currentVerseId, verseRef);
          showFlash(`Cue ${slot} set \u2192 ${verseRef}`);
          if (s.showPanel) refreshPanelData();
        } catch { /* DB */ }
        return;
      }

      if (str && cueJumpKeys.includes(str)) {
        const slot = parseInt(str, 10);
        try {
          const cue = getCue(slot);
          if (cue) {
            setSelectedSurahId(cue.surah);
            setCurrentVerseId(cue.ayah);
            refreshBookmarks();
            showFlash(`Jumped to Cue ${slot} (${cue.verseRef})`);
          }
        } catch { /* DB */ }
        return;
      }

      if (str === 'j' || key.name === 'down') {
        const surah = getSurah(s.selectedSurahId);
        if (surah && s.currentVerseId < surah.totalVerses) {
          const newVerse = s.currentVerseId + 1;
          setCurrentVerseId(prev => prev + 1);
          if (s.readingMode) {
            try { logVerse(`${s.selectedSurahId}:${newVerse}`); } catch { /* DB */ }
          }
        }
      }
      if (str === 'k' || key.name === 'up') {
        if (s.currentVerseId > 1) {
          const newVerse = s.currentVerseId - 1;
          setCurrentVerseId(prev => prev - 1);
          if (s.readingMode) {
            try { logVerse(`${s.selectedSurahId}:${newVerse}`); } catch { /* DB */ }
          }
        }
      }
      if (str === 'b') {
        const verseRef = `${s.selectedSurahId}:${s.currentVerseId}`;
        try {
          toggleBookmark(s.selectedSurahId, s.currentVerseId, verseRef);
          refreshBookmarks();
          if (s.showPanel) refreshPanelData();
        } catch {
          // DB may not be available
        }
      }
      if (str === 'c') {
        showFlash("Fetching ayah image…");
        copyAyahImage(s.selectedSurahId, s.currentVerseId)
          .then(() => showFlash(`Copied ${s.selectedSurahId}:${s.currentVerseId} image ✓`))
          .catch((e: Error) => showFlash(`Copy failed: ${e.message}`));
        return;
      }
      if (str === 'h') {
        setShowHelp(true);
      }
      if (str === 'm') {
        setReadingMode(prev => {
          const next = !prev;
          showFlash(next ? "📖 Reading mode" : "📋 Browsing mode");
          return next;
        });
      }
    }
  });

  useEffect(() => {
    // Don't run startup work while calibration dialog is active
    if (showCalibration) return;

    refreshBookmarks();
    refreshPanelData();
    refreshCompletionData();
  }, [showCalibration]);

  // Refresh read-verse data when surah changes
  useEffect(() => {
    refreshCompletionData();
  }, [selectedSurahId]);

  const { theme } = useTheme();
  // const { resolvedMode } = useMode();

  if (showCalibration) {
    return (
      <RouteProvider key={theme.id}>
        <RtlCalibrationDialog
          onDone={(strategy) => {
            setRtlStrategy(strategy);
            try { setPreference("rtlStrategy", strategy); } catch { /* DB */ }
            setShowCalibration(false);
          }}
        />
      </RouteProvider>
    );
  }

  return (
    <RouteProvider key={theme.id}>
      <Layout
        showSidebar={showSidebar}
        showPanel={showPanel}
        sidebarFocused={focusedPanel === "sidebar"}
        panelFocused={focusedPanel === "panel"}
        sidebar={
          <box flexDirection="column" height="100%">
            <box height="15%">
              <StreakChart />
            </box>
            <box height="17%" minHeight={3}>
              <ReadingStats
                sessionStart={sessionStartRef.current}
                focused={focusedPanel === "sidebar" && sidebarSubFocus === "stats"}
              />
            </box>
            <box height="68%">
              <SurahList
                onSelect={(id) => {
                  const s = stateRef.current;
                  if (s.readingMode && s.selectedSurahId !== id) {
                    // Skip the dialog if this surah was already marked as read this session
                    if (markedSurahsRef.current.has(s.selectedSurahId)) {
                      setSelectedSurahId(id);
                      setCurrentVerseId(1);
                      try { setBookmarkedAyahs(getBookmarkedAyahs(id)); } catch { /* DB */ }
                      return;
                    }
                    setPendingSurahChange({ fromId: s.selectedSurahId, toId: id });
                    setShowMarkSurahDialog(true);
                    return;
                  }
                  setSelectedSurahId(id);
                  setCurrentVerseId(1);
                  try {
                    setBookmarkedAyahs(getBookmarkedAyahs(id));
                  } catch {
                    // DB may not be available
                  }
                }}
                selectedId={selectedSurahId}
                focused={focusedPanel === "sidebar" && sidebarSubFocus === "surahList"}
                disabled={anyModalOpen}
                completedSurahIds={completedSurahIds}
                onSearchFocusChange={setSurahSearchFocused}
              />
            </box>
          </box>
        }
        panel={
          <Panel
            bookmarks={allBookmarks}
            cues={allCues}
            reflections={allReflections}
            activeTab={panelTab}
            selectedIndex={panelIndex}
            focused={focusedPanel === "panel"}
          />
        }
      >
        <Reader
          surahId={selectedSurahId}
          focusedPane={focusedPanel}
          currentVerseId={currentVerseId}
          bookmarkedAyahs={bookmarkedAyahs}
          readVerseIds={readVerseIds}
          searchResults={searchResults}
          searchQuery={searchQuery}
          isSearchMode={isSearchMode}
          searchInput={searchInput}
          showArabic={showArabic}
          showArabicImage={showArabicImage}
          showTranslation={showTranslation}
          showTransliteration={showTransliteration}
          language={language}
          arabicZoom={arabicZoom}
          modalOpen={anyModalOpen}
          arabicAlign={arabicAlign}
          arabicWidth={arabicWidth}
          arabicFlow={arabicFlow}
          onVerseSelect={(verseId) => {
            setCurrentVerseId(verseId);
          }}
        />
        {flashMessage && (
          <box
            position="absolute"
            bottom={2}
            right={2}
            padding={1}
            backgroundColor={theme.colors.secondary}
          >
            <text fg={theme.colors.background}>{flashMessage}</text>
          </box>
        )}
        <ImageWarningDialog
          visible={showImageWarningDialog}
          onConfirm={() => {
            setHasSeenImageWarning(true);
            setShowImageWarningDialog(false);
            setShowArabicImage(true);
          }}
        />
        <HelpDialog visible={showHelp} />
        <CommandPalette
          visible={showPalette}
          commands={paletteCommands}
          selectedIndex={paletteIndex}
        />
        <ReflectionDialog
          visible={showReflectionDialog}
          verseRef={`${selectedSurahId}:${currentVerseId}`}
          note={reflectionInput}
          onClose={() => setShowReflectionDialog(false)}
          onSave={(note) => {
            addReflection(selectedSurahId, currentVerseId, `${selectedSurahId}:${currentVerseId}`, note);
            setShowReflectionDialog(false);
            refreshPanelData();
            showFlash("Reflection saved");
          }}
          onInput={(text) => setReflectionInput(text)}
        />
        <MarkSurahDialog
          visible={showMarkSurahDialog}
          surahName={pendingSurahChange ? (getSurah(pendingSurahChange.fromId)?.transliteration ?? `Surah ${pendingSurahChange.fromId}`) : ""}
          onConfirm={() => {
            if (pendingSurahChange) {
              const surah = getSurah(pendingSurahChange.fromId);
              if (surah) {
                try { logSurah(surah); } catch { /* DB */ }
              }
              // Remember this surah was marked so we don't ask again (issue #5)
              markedSurahsRef.current.add(pendingSurahChange.fromId);
              setSelectedSurahId(pendingSurahChange.toId);
              setCurrentVerseId(1);
              try { setBookmarkedAyahs(getBookmarkedAyahs(pendingSurahChange.toId)); } catch { /* DB */ }
              if (showPanel) refreshPanelData();
              refreshCompletionData();
            }
            setShowMarkSurahDialog(false);
            setPendingSurahChange(null);
          }}
          onDismiss={() => {
            if (pendingSurahChange) {
              setSelectedSurahId(pendingSurahChange.toId);
              setCurrentVerseId(1);
              try { setBookmarkedAyahs(getBookmarkedAyahs(pendingSurahChange.toId)); } catch { /* DB */ }
            }
            setShowMarkSurahDialog(false);
            setPendingSurahChange(null);
          }}
        />
        <ResetTrackingDialog
          visible={showResetDialog}
          onConfirm={(period: ResetPeriod) => {
            try {
              const result = deleteReadingLog(period, sessionStartRef.current);
              showFlash(result.message);
              // Clear session-local marked surahs when resetting session or all
              if (period === "session" || period === "all") {
                markedSurahsRef.current.clear();
              }
              refreshCompletionData();
            } catch { /* DB */ }
            setShowResetDialog(false);
          }}
          onDismiss={() => setShowResetDialog(false)}
        />
        <FuzzySearchDialog
          visible={showFuzzySearch}
          onSelect={(surahId, verseId) => {
            setSelectedSurahId(surahId);
            setCurrentVerseId(verseId);
            setShowFuzzySearch(false);
            try { setBookmarkedAyahs(getBookmarkedAyahs(surahId)); } catch { /* DB */ }
            refreshCompletionData();
          }}
          onDismiss={() => setShowFuzzySearch(false)}
        />
      </Layout>
    </RouteProvider>
  );
};

function App() {
  return (
    <ModeProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </ModeProvider>
  );
};

export default App;
