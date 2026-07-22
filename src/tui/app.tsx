import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { lazy, Suspense, useState, useEffect, useCallback, useRef, useReducer } from "react";
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
import { toggleBookmark, getBookmarkedAyahs, getAllBookmarks } from "../data/bookmarks";
import type { Bookmark } from "../data/bookmarks";
import { setCue, getCue, getAllCues } from "../data/cues";
import type { Cue } from "../data/cues";
import { getAllReflections, addReflection, getReflection } from "../data/reflections";
import type { Reflection } from "../data/reflections";
import { getSurah, search, LANGUAGES, isLanguageLoaded, loadLanguage } from "../data/quran";
import { logVerse } from "../data/log";
import { logSurah, deleteReadingLog, getCompletedSurahIds, getReadVerseIds } from "../data/log";
import type { ResetPeriod } from "../data/log";
import { getPreference, setPreference } from "../data/preferences";
import type { VerseRef } from "../data/quran";
import { ThemeProvider, useTheme } from "./theme";
import type { Theme } from "./theme";
import { ModeProvider, useMode } from "./mode";
import { buildAppCommands, type AppCommandId, type CommandActions } from "./commands.ts";
import { firstReaderPane, focusReducer, type FocusablePane, type PaneVisibility } from "./focus.ts";
import { ChoiceDialog, type ChoiceDialogState } from "./components/choice-dialog.tsx";
import { PlaybackStatus } from "./components/playback-status.tsx";
import { acceptOnlineSources, ONLINE_QURAN_SOURCE_DISCLOSURE, onlineSourcesAccepted as sharedOnlineSourcesAccepted } from "../features/network/online-source-consent.ts";
import { parseWordKey } from "../domain/quran-coordinate.ts";
import { useRecitationPlayback } from "./use-recitation-playback.ts";

export { useTheme };
export type { Theme };

export type { FocusablePane } from "./focus.ts";

export type ArabicAlign = "right" | "center" | "left";
export type ArabicWidth = "100%" | "80%" | "60%";
export type ArabicFlow = "verse" | "continuous";

const LazyTafsirReader = lazy(async () => {
  const module = await import("./components/tafsir-reader.tsx");
  return { default: module.TafsirReader };
});

function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

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
  hasSeenImageWarning: loadPref("onlineImage.islamicNetworkCdnAccepted.v1", "false") === "true",
};

// Apply saved RTL strategy immediately (before any render)
if (savedPrefs.rtlStrategy) {
  setRtlStrategy(savedPrefs.rtlStrategy as RtlStrategy);
}

function AppContent({ safeMode = false }: { readonly safeMode?: boolean }) {
  const { cycleTheme } = useTheme();
  const { cycleMode } = useMode();
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();

  const [selectedSurahId, setSelectedSurahId] = useState(savedPrefs.selectedSurahId);
  const [focusedPanel, dispatchFocus] = useReducer(focusReducer, "sidebar");
  const setFocusedPanel = useCallback((pane: FocusablePane) => {
    dispatchFocus({ type: "set", pane });
  }, []);
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
  const [language, setLanguage] = useState(isLanguageLoaded(savedPrefs.language) ? savedPrefs.language : "en");
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
  const [showTafsir, setShowTafsir] = useState(false);
  const [playbackDialog, setPlaybackDialog] = useState<ChoiceDialogState | null>(null);
  const [onlineSourcesAccepted, setOnlineSourcesAccepted] = useState(() => sharedOnlineSourcesAccepted());
  const [openTafsirPicker, setOpenTafsirPicker] = useState(false);
  const closeTafsir = useCallback(() => {
    setShowTafsir(false);
    setOpenTafsirPicker(false);
  }, []);

  useEffect(() => {
    if (savedPrefs.language === "en") return;
    void loadLanguage(savedPrefs.language).then(() => setLanguage(savedPrefs.language));
  }, []);

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
      setPreference("onlineImage.islamicNetworkCdnAccepted.v1", String(hasSeenImageWarning));
    } catch { /* DB may not be available in tests */ }
  }, [selectedSurahId, currentVerseId, showArabic, showArabicImage, showTranslation, showTransliteration, language, arabicAlign, arabicWidth, arabicFlow, arabicZoom, showSidebar, showPanel, readingMode, hasSeenImageWarning]);

  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFlash = useCallback((msg: string) => {
    setFlashMessage(msg);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashMessage(""), 2000);
  }, []);

  const verseKey = `${selectedSurahId}:${currentVerseId}` as const;
  const navigateForPlayback = useCallback((key: `${number}:${number}`) => {
    const [nextSurah, nextVerse] = key.split(":").map(Number);
    if (!nextSurah || !nextVerse || !getSurah(nextSurah)?.verses[nextVerse - 1]) return;
    setSelectedSurahId(nextSurah);
    setCurrentVerseId(nextVerse);
    try { setBookmarkedAyahs(getBookmarkedAyahs(nextSurah)); } catch { /* DB may be unavailable */ }
  }, []);
  const playback = useRecitationPlayback({
    verseKey,
    safeMode,
    onlineSourcesAccepted,
    onNavigate: navigateForPlayback,
    onMessage: showFlash,
    onDialog: setPlaybackDialog,
  });

  const togglePlayback = useCallback(() => {
    if (playback.isFollowing) {
      playback.stop();
      return;
    }
    if (safeMode) {
      showFlash("Playback is off in safe mode");
      return;
    }
    if (onlineSourcesAccepted) {
      void playback.play();
      return;
    }
    const acceptAndPlay = (persist: boolean) => {
      acceptOnlineSources(persist);
      setOnlineSourcesAccepted(true);
      setPlaybackDialog(null);
      showFlash("Online Quran sources enabled");
      void playback.play({ allowOnlineSources: true });
    };
    setPlaybackDialog({
      title: "Online sources for recitation",
      description: ONLINE_QURAN_SOURCE_DISCLOSURE,
      choices: [{ key: "o", label: "OK", action: () => acceptAndPlay(false) }, {
        key: "d", label: "Don't show again", action: () => acceptAndPlay(true),
      }, {
        key: "c", label: "Cancel", action: () => { setPlaybackDialog(null); showFlash("Playback remains off"); },
      }],
      onDismiss: () => { setPlaybackDialog(null); showFlash("Playback remains off"); },
    });
  }, [onlineSourcesAccepted, playback, safeMode, showFlash]);

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
    dispatchFocus({
      type: "cycle",
      visibility: { showSidebar, showArabic, showTranslation, showTransliteration, showPanel },
    });
  }, [showSidebar, showArabic, showTranslation, showTransliteration, showPanel]);

  // True when any modal/overlay is open — used to disable focus on child components
  const anyModalOpen = showPalette || showReflectionDialog || showHelp || isSearchMode || showMarkSurahDialog || showResetDialog || showFuzzySearch || showCalibration || showImageWarningDialog || showTafsir || playbackDialog !== null;

  // Keep the latest state available inside the keyboard handler
  // (avoids stale closures without needing to list every state var as dep)
  const sessionStartRef = useRef(new Date().toISOString());
  const stateRef = useLatest({
    selectedSurahId, currentVerseId, focusedPanel, isSearchMode, searchInput,
    searchResults, showHelp, showSidebar, showPanel, showPalette, paletteIndex,
    showReflectionDialog, reflectionInput, showArabic, showArabicImage, showTranslation, showTransliteration,
    language, panelTab, panelIndex, allBookmarks, allCues, allReflections, anyModalOpen,
    arabicAlign, arabicWidth, arabicFlow, readingMode, hasSeenImageWarning, showImageWarningDialog,
    showMarkSurahDialog, showResetDialog, showFuzzySearch, showCalibration, showTafsir, playbackDialog,
  });

  const paneVisibility = (overrides: Partial<PaneVisibility> = {}): PaneVisibility => ({
    showSidebar: stateRef.current.showSidebar,
    showArabic: stateRef.current.showArabic,
    showTranslation: stateRef.current.showTranslation,
    showTransliteration: stateRef.current.showTransliteration,
    showPanel: stateRef.current.showPanel,
    ...overrides,
  });

  const commandActions: CommandActions = {
    "toggle-arabic": () => {
      const s = stateRef.current;
      const next = !s.showArabic;
      setShowArabic(next);
      if (!next && s.focusedPanel === "arabic") {
        setFocusedPanel(firstReaderPane(paneVisibility({ showArabic: false })));
      }
    },
    "toggle-image": () => {
      if (!stateRef.current.hasSeenImageWarning) setShowImageWarningDialog(true);
      else setShowArabicImage((visible) => !visible);
    },
    "toggle-translation": () => {
      const s = stateRef.current;
      const next = !s.showTranslation;
      setShowTranslation(next);
      if (!next && s.focusedPanel === "translation") {
        setFocusedPanel(firstReaderPane(paneVisibility({ showTranslation: false })));
      }
    },
    "toggle-transliteration": () => {
      const s = stateRef.current;
      const next = !s.showTransliteration;
      setShowTransliteration(next);
      if (!next && s.focusedPanel === "transliteration") {
        setFocusedPanel(firstReaderPane(paneVisibility({ showTransliteration: false })));
      }
    },
    "cycle-language": () => {
      const languageIndex = LANGUAGES.indexOf(stateRef.current.language as (typeof LANGUAGES)[number]);
      if (languageIndex !== -1) {
        const next = LANGUAGES[(languageIndex + 1) % LANGUAGES.length]!;
        void loadLanguage(next).then(() => setLanguage(next)).catch(() => showFlash(`Could not load ${next.toUpperCase()} translation`));
      }
    },
    "toggle-reading": () => setReadingMode((enabled) => {
      const next = !enabled;
      showFlash(next ? "📖 Reading mode" : "📋 Browsing mode");
      return next;
    }),
    "cycle-mode": cycleMode,
    "cycle-theme": cycleTheme,
    "toggle-sidebar": () => {
      const s = stateRef.current;
      const next = !s.showSidebar;
      setShowSidebar(next);
      if (!next && s.focusedPanel === "sidebar") {
        setFocusedPanel(firstReaderPane(paneVisibility({ showSidebar: false })));
      } else if (next) {
        setFocusedPanel("sidebar");
      }
    },
    "toggle-panel": () => {
      const s = stateRef.current;
      const next = !s.showPanel;
      setShowPanel(next);
      if (!next && s.focusedPanel === "panel") {
        setFocusedPanel(firstReaderPane(paneVisibility({ showPanel: false })));
      } else if (next) {
        refreshPanelData();
        setFocusedPanel("panel");
      }
    },
    "zoom-in": () => setArabicZoom((zoom) => Math.min(zoom + 1, 5)),
    "zoom-out": () => setArabicZoom((zoom) => Math.max(zoom - 1, 0)),
    "cycle-align": () => {
      const values: ArabicAlign[] = ["right", "center", "left"];
      const current = values.indexOf(stateRef.current.arabicAlign);
      const next = values[(current + 1) % values.length]!;
      setArabicAlign(next);
      showFlash(`Arabic align: ${next}`);
    },
    "cycle-width": () => {
      const values: ArabicWidth[] = ["100%", "80%", "60%"];
      const current = values.indexOf(stateRef.current.arabicWidth);
      const next = values[(current + 1) % values.length]!;
      setArabicWidth(next);
      showFlash(`Arabic width: ${next}`);
    },
    "cycle-flow": () => {
      const values: ArabicFlow[] = ["verse", "continuous"];
      const current = values.indexOf(stateRef.current.arabicFlow);
      const next = values[(current + 1) % values.length]!;
      setArabicFlow(next);
      showFlash(`Arabic flow: ${next}`);
    },
    "toggle-bookmark": () => {
      const s = stateRef.current;
      try {
        toggleBookmark(s.selectedSurahId, s.currentVerseId, `${s.selectedSurahId}:${s.currentVerseId}`);
        refreshBookmarks();
        if (s.showPanel) refreshPanelData();
      } catch { /* DB may not be available in tests */ }
    },
    "copy-image": () => {
      const s = stateRef.current;
      showFlash("Fetching ayah image…");
      copyAyahImage(s.selectedSurahId, s.currentVerseId)
        .then(() => showFlash(`Copied ${s.selectedSurahId}:${s.currentVerseId} image ✓`))
        .catch((error: Error) => showFlash(`Copy failed: ${error.message}`));
    },
    "add-reflection": () => {
      const s = stateRef.current;
      try {
        setReflectionInput(getReflection(s.selectedSurahId, s.currentVerseId)?.note ?? "");
        setShowReflectionDialog(true);
      } catch { /* DB may not be available in tests */ }
    },
    "cycle-focus": cycleFocus,
    search: () => {
      setIsSearchMode(true);
      setSearchInput("");
      setFocusedPanel(firstReaderPane(paneVisibility()));
    },
    "fuzzy-search": () => setShowFuzzySearch(true),
    "open-tafsir": () => {
      if (safeMode) showFlash("Online tafsir is disabled in safe mode");
      else {
        setOpenTafsirPicker(false);
        setShowTafsir(true);
      }
    },
    "choose-tafsir": () => {
      if (safeMode) showFlash("Online tafsir is disabled in safe mode");
      else {
        setOpenTafsirPicker(true);
        setShowTafsir(true);
      }
    },
    "toggle-playback": togglePlayback,
    help: () => setShowHelp(true),
    "reset-tracking": () => setShowResetDialog(true),
    reindex: () => {
      showFlash("Re-indexing…");
      reindex(stateRef.current.language)
        .then(() => showFlash("Search index rebuilt ✓"))
        .catch((error: Error) => showFlash(`Re-index failed: ${error.message}`));
    },
    calibrate: () => setShowCalibration(true),
    quit: () => renderer.destroy(),
  };

  const paletteCommands = buildAppCommands(commandActions);
  const runCommand = (id: AppCommandId): void => {
    paletteCommands.find((command) => command.id === id)?.action();
  };

  useKeyboard((key) => {
    const s = stateRef.current;
    const str = key.sequence || key.name;

    if (s.showPalette) {
      if (key.name === "escape" || (key.ctrl && key.name === "p")) {
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
      if (key.name === "return" || key.name === "enter") {
        const cmd = paletteCommands[s.paletteIndex];
        if (cmd) {
          cmd.action();
          setShowPalette(false);
        }
        return;
      }
      return;
    }

    // Dialogs with their own keyboard hooks exclusively own input while open.
    if (
      s.showCalibration ||
      s.showImageWarningDialog ||
      s.showMarkSurahDialog ||
      s.showResetDialog ||
      s.showFuzzySearch ||
      s.showTafsir ||
      s.playbackDialog
    ) return;

    if (s.showReflectionDialog) {
      if (key.name === "escape") {
        setShowReflectionDialog(false);
        return;
      }
      if (key.name === "return" || key.name === "enter") {
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

    if (s.isSearchMode) {
      if (key.name === 'escape') {
        setIsSearchMode(false);
        setSearchInput("");
        setSearchResults([]);
        setSearchQuery("");
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        const query = s.searchInput;
        if (query.trim().length > 0) {
          const results = search(query, s.language);
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
      // SurahList owns `/` and moves focus into its inline search input.
      if (str === "/") return;
      // Fall through to global shortcuts below
    }

    if (key.ctrl && key.name === "p") {
      setShowPalette(true);
      setPaletteIndex(0);
      return;
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

    const shortcut = key.ctrl && key.name === "f"
      ? "Ctrl+F"
      : key.name === "tab"
        ? "Tab"
        : str === "="
          ? "+"
          : str;
    const globalCommand = paletteCommands.find(
      (command) => command.scope === "global" && command.key === shortcut,
    );
    if (globalCommand) {
      globalCommand.action();
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
          setCurrentVerseId((prev) => Math.min(surah.totalVerses, prev + 1));
          if (s.readingMode) {
            try { logVerse(`${s.selectedSurahId}:${newVerse}`); } catch { /* DB */ }
          }
        }
      }
      if (str === 'k' || key.name === 'up') {
        if (s.currentVerseId > 1) {
          const newVerse = s.currentVerseId - 1;
          setCurrentVerseId((prev) => Math.max(1, prev - 1));
          if (s.readingMode) {
            try { logVerse(`${s.selectedSurahId}:${newVerse}`); } catch { /* DB */ }
          }
        }
      }
      if (str === 'b') {
        runCommand("toggle-bookmark");
        return;
      }
      if (str === 'c') {
        runCommand("copy-image");
        return;
      }
      if (str === 'h') {
        runCommand("help");
        return;
      }
      if (str === 'm') {
        runCommand("toggle-reading");
        return;
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

  const activePlaybackCoordinate = playback.activeWordKey ? parseWordKey(playback.activeWordKey) : null;
  const activePlaybackWord = activePlaybackCoordinate?.key.startsWith(`${verseKey}:`) ? activePlaybackCoordinate.word : null;
  const selectedVerse = getSurah(selectedSurahId, language)?.verses[currentVerseId - 1];
  const totalPlaybackWords = selectedVerse?.text.trim().split(/\s+/u).filter(Boolean).length ?? 0;
  const readerWidth = Math.max(32, Math.floor(dimensions.width * (1 - (showSidebar ? 0.25 : 0) - (showPanel ? 0.25 : 0))));
  const showPlaybackStatus = playback.isFollowing || playback.visual.status !== "idle";

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
        status={showPlaybackStatus ? (
          <PlaybackStatus
            value={playback.visual}
            verseKey={verseKey}
            activeWord={activePlaybackWord}
            totalWords={totalPlaybackWords}
            width={readerWidth}
            timed={playback.hasTimings}
            compact
          />
        ) : undefined}
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
                language={language}
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
          activeWordKey={playback.activeWordKey}
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
          onCancel={() => {
            setShowImageWarningDialog(false);
            showFlash("Keeping the local Arabic text view");
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
          language={language}
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
      <ChoiceDialog
        visible={playbackDialog !== null}
        title={playbackDialog?.title ?? ""}
        description={playbackDialog?.description ?? []}
        choices={playbackDialog?.choices ?? []}
        onDismiss={() => playbackDialog?.onDismiss ? playbackDialog.onDismiss() : setPlaybackDialog(null)}
      />
      {showTafsir && (
        <Suspense fallback={<text position="absolute" top={1} left={2} zIndex={170} fg="#d8b45d">Loading tafsir reader…</text>}>
          <LazyTafsirReader
            verseKey={`${selectedSurahId}:${currentVerseId}`}
            onDismiss={closeTafsir}
            openPicker={openTafsirPicker}
          />
        </Suspense>
      )}
    </RouteProvider>
  );
};

function App({ safeMode = false }: { readonly safeMode?: boolean }) {
  return (
    <ModeProvider>
      <ThemeProvider>
        <AppContent safeMode={safeMode} />
      </ThemeProvider>
    </ModeProvider>
  );
};

export default App;
