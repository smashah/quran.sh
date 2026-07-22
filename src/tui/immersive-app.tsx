import { useKeyboard, useRenderer, useTerminalDimensions, useTimeline } from "@opentui/react";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSurah } from "../data/quran.ts";
import { presentationFor, READING_MODES, type CapabilityState, type ReadingExperienceMode } from "../features/experience/mode.ts";
import { useFeatureCommand, useFeatureState } from "../features/react.tsx";
import type { RecitationPlayer, RecitationPlayerState } from "../features/audio/player.ts";
import type { TimedRecitationSession } from "../features/audio/timed-session.ts";
import type { StudyService, StudySnapshot } from "../features/study/service.ts";
import type { QuranReadingLayout, QuranReadingSurface, QuranScriptStyle, VisualBackdrop } from "../features/spatial/types.ts";
import { coherentVerseRows, exactLocalPageLines, pageFlowLines, resourceText, wordPosition } from "../features/spatial/reading-surface.ts";
import type { FollowCoordinator } from "../features/recognition/follow-coordinator.ts";
import type { TilawaRecognizer } from "../features/recognition/types.ts";
import { chooseReaderLayout, readerTransitionDuration } from "./responsive.ts";
import { getRtlStrategy, renderedArabicWordRange, RTL_STRATEGIES, renderArabicVerse, setRtlStrategy, wrapTerminalWords, type RtlStrategy } from "./utils/rtl.ts";
import { getPreference, setPreference } from "../data/preferences.ts";
import { parseWordKey, type WordKey } from "../domain/quran-coordinate.ts";
import { APP_DATA_DIR } from "../data/db.ts";
import { STARTER_RECITATION_PACK } from "../features/resources/public-recitation.ts";
import { ChoiceDialog, type DialogChoice } from "./components/choice-dialog.tsx";
import { TerminalIllumination } from "./components/terminal-illumination.tsx";
import { ModeProvider } from "./mode.tsx";
import { ThemeProvider } from "./theme.tsx";
import { networkPlaybackIdentity } from "../features/audio/network-permission.ts";
import type { ResourceRow, ResourceTextBlock } from "../features/resources/repository.ts";
import type { HadithPage, HadithRecord } from "../features/hadith/types.ts";
import { acceptOnlineSources, onlineSourcesAccepted as sharedOnlineSourcesAccepted } from "../features/network/online-source-consent.ts";

const SELECTED_TAFSIR_RESOURCE_KEY = "selectedTafsirResourceId";
const PLAYBACK_NAVIGATION_DEBOUNCE_MS = 180;
type StudySource = "local" | "online" | "hybrid";
type NavigationIntent = "manual" | "completion";

const LazyImageReader = lazy(async () => {
  const module = await import("./components/image-reader.tsx");
  return { default: module.ImageReader };
});

const LazyFuzzySearchDialog = lazy(async () => {
  const module = await import("./components/fuzzy-search-dialog.tsx");
  return { default: module.FuzzySearchDialog };
});

const modeLabels: Record<ReadingExperienceMode, string> = {
  focus: "Focus", learn: "Learn", recite: "Recite", memorise: "Memorise",
};

interface OpenDialog {
  readonly title: string;
  readonly description: readonly string[];
  readonly choices: readonly DialogChoice[];
  readonly onDismiss?: () => void;
}

interface PlaybackVisualState {
  readonly status: "idle" | "loading" | "buffering" | "playing";
  readonly elapsedMs: number;
  readonly bufferedMs: number;
  readonly durationMs: number | null;
}

const IDLE_PLAYBACK_VISUAL: PlaybackVisualState = {
  status: "idle",
  elapsedMs: 0,
  bufferedMs: 0,
  durationMs: null,
};

function playbackDuration(rows: readonly ResourceRow[]): number | null {
  const duration = rows.flatMap((row) => row.segments ?? []).reduce((largest, segment) => Math.max(largest, segment[2]), 0);
  return duration > 0 ? duration : null;
}

function playbackVisualFrom(state: RecitationPlayerState, durationMs: number | null): PlaybackVisualState {
  if (state.status === "playing") return { status: "playing", elapsedMs: state.elapsedMs, bufferedMs: state.bufferedMs, durationMs };
  if (state.status === "buffering") return { status: "buffering", elapsedMs: 0, bufferedMs: 0, durationMs };
  return IDLE_PLAYBACK_VISUAL;
}

function formatClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function fitTerminalLabel(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  return width === 1 ? "…" : `${value.slice(0, width - 1)}…`;
}

function centerTerminalLines(value: string, width: number): string {
  return wrapTerminalWords(value, Math.max(1, width)).map((line) => {
    const padding = Math.max(0, Math.floor((width - line.length) / 2));
    return `${" ".repeat(padding)}${line}`;
  }).join("\n");
}

function ArabicBlock({
  value,
  width,
  fg = "#f2ead8",
  bold = false,
  marginBottom,
}: {
  readonly value: string;
  readonly width: number;
  readonly fg?: string;
  readonly bold?: boolean;
  readonly marginBottom?: number;
}) {
  const lines = renderArabicVerse(value, 0, Math.max(1, width)).split("\n");
  return (
    <box width="100%" height={Math.max(1, lines.length)} flexShrink={0} flexDirection="column" alignItems="flex-end" overflow="hidden" marginBottom={marginBottom}>
      {lines.map((line, index) => (
        <text key={`arabic-line-${index}`} fg={fg} attributes={bold ? TextAttributes.BOLD : undefined} wrapMode="none">{line}</text>
      ))}
    </box>
  );
}

function PlaybackStatus({
  value,
  verseKey,
  activeWord,
  totalWords,
  width,
  timed,
}: {
  readonly value: PlaybackVisualState;
  readonly verseKey: string;
  readonly activeWord: number | null;
  readonly totalWords: number;
  readonly width: number;
  readonly timed: boolean;
}) {
  const barWidth = Math.max(12, Math.min(48, width - 34));
  const ratio = value.durationMs ? Math.min(1, value.elapsedMs / value.durationMs) : 0;
  const filled = value.status === "buffering" || value.status === "loading"
    ? Math.max(1, Math.floor(barWidth * 0.08))
    : Math.round(barWidth * ratio);
  const label = value.status === "playing"
    ? timed && activeWord ? `FOLLOWING WORD ${activeWord}/${Math.max(activeWord, totalWords)}` : "FOLLOWING AYAH"
    : value.status === "buffering" ? "BUFFERING RECITATION" : "PREPARING RECITATION";
  const clock = value.durationMs ? `${formatClock(value.elapsedMs)} / ${formatClock(value.durationMs)}` : formatClock(value.elapsedMs);
  return (
    <box width={width} height={4} borderStyle="single" borderColor="#315a57" flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg="#62c2b8"><strong>{`▶ ${label} · ${verseKey}`}</strong></text>
        <text fg="#78908d">{`${clock} · next ayah readying`}</text>
      </box>
      <text fg="#d8b45d">{`${"━".repeat(filled)}${"─".repeat(Math.max(0, barWidth - filled))}`}</text>
    </box>
  );
}

function deepestErrorMessage(cause: unknown, fallback: string): string {
  let current = cause;
  let message = fallback;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (current.message) message = current.message;
    current = current.cause;
  }
  return message;
}

function adjacentVerseKey(surahId: number, verseId: number, direction: 1 | -1): `${number}:${number}` | null {
  const surah = getSurah(surahId);
  if (!surah) return null;
  const nextVerse = verseId + direction;
  if (nextVerse >= 1 && nextVerse <= surah.totalVerses) return `${surahId}:${nextVerse}`;
  const adjacentSurahId = surahId + direction;
  const adjacentSurah = getSurah(adjacentSurahId);
  if (!adjacentSurah) return null;
  return `${adjacentSurahId}:${direction === 1 ? 1 : adjacentSurah.totalVerses}`;
}

function selectedTafsirResourceId(): number | undefined {
  const saved = Number(getPreference(SELECTED_TAFSIR_RESOURCE_KEY));
  return Number.isSafeInteger(saved) && saved > 0 ? saved : undefined;
}

function quranComHadithUrl(verseKey: string): string {
  const [surahNumber, ayahNumber] = verseKey.split(":").map(Number);
  const surah = getSurah(surahNumber ?? 0);
  if (!surah || !Number.isSafeInteger(ayahNumber) || ayahNumber! < 1 || !surah.verses[ayahNumber! - 1]) {
    throw new Error(`Invalid Quran coordinate: ${verseKey}`);
  }
  const slug = surah.transliteration
    .toLocaleLowerCase("en")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `https://quran.com/${slug}/${ayahNumber}/hadith`;
}

function ResourceAttribution({ row, compact = false }: { readonly row: ResourceRow; readonly compact?: boolean }) {
  const provenance = row.provenance;
  if (!provenance) return <text fg="#52646b">Installed resource · attribution unavailable</text>;
  const termsUrl = typeof row.raw.termsUrl === "string" ? row.raw.termsUrl : undefined;
  if (compact) {
    return <text fg="#60727a" wrapMode="word">{`${provenance.attribution} · ${provenance.license}`}</text>;
  }
  return (
    <box flexDirection="column" marginBottom={1}>
      <text fg="#60727a" wrapMode="char">{`${provenance.attribution} · ${provenance.license}`}</text>
      {provenance.sourceUrl && <text fg="#52646b" wrapMode="char">{`Source: ${provenance.sourceUrl}`}</text>}
      {termsUrl && <text fg="#52646b" wrapMode="char">{`Terms: ${termsUrl}`}</text>}
    </box>
  );
}

function StudyPanel({
  snapshot,
  source,
  verseKey,
  verseText,
  verseTranslation,
  width,
  height,
  overlay = false,
}: {
  readonly snapshot: StudySnapshot | null;
  readonly source: StudySource | null;
  readonly verseKey: string;
  readonly verseText: string;
  readonly verseTranslation: string;
  readonly width: number;
  readonly height?: number;
  readonly overlay?: boolean;
}) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  useEffect(() => scrollRef.current?.scrollTo(0), [verseKey]);
  useKeyboard((key) => {
    if (key.sequence === "[") scrollRef.current?.scrollBy(-5);
    if (key.sequence === "]") scrollRef.current?.scrollBy(5);
  });
  const tafsirRow = snapshot?.tafsir[0];
  const translationRow = snapshot?.translation[0];
  const tafsirBlocks = tafsirRow?.contentBlocks;
  const wide = width >= 78 && (height ?? 24) >= 18;
  const contextWidth = wide ? Math.max(30, Math.min(44, Math.floor((width - 5) * 0.38))) : Math.max(20, width - 4);
  const contentWidth = wide ? Math.max(24, width - contextWidth - 8) : Math.max(20, width - 4);
  const displayText = (row: ResourceRow, value = row.text ?? ""): string => {
    if (!value) return "";
    const rtl = row.direction === "rtl" || row.language === "ar" || /[\u0600-\u06ff]/u.test(value);
    return rtl
      ? renderArabicVerse(value, 0, contentWidth)
      : wrapTerminalWords(value, contentWidth).join("\n");
  };
  const displayBlock = (block: ResourceTextBlock): string => wrapTerminalWords(block.text, contentWidth).join("\n");
  const sourceLabel = source === "hybrid" ? "LOCAL + ONLINE" : source === "online" ? "ONLINE" : "LOCAL";
  const translation = translationRow?.text ? displayText(translationRow) : wrapTerminalWords(verseTranslation, Math.max(20, contextWidth - 4)).join("\n");
  const contextTextWidth = Math.max(16, contextWidth - 4);
  const position = overlay
    ? { position: "absolute" as const, top: 3, left: 2, zIndex: 150, backgroundColor: "#081017" }
    : { zIndex: 150, backgroundColor: "#081017" };
  return (
    <box {...position} width={width} height={height} borderStyle="rounded" borderColor="#476672" flexDirection="column" padding={1}>
      <box height={1} width="100%" flexDirection="row" justifyContent="space-between">
        <text fg="#f1d77c"><strong>{`Study · Tafsir · ${verseKey}`}</strong></text>
        <text fg="#78908d">{`${sourceLabel} · [/] scroll · w closes`}</text>
      </box>
      <box flexGrow={1} width="100%" flexDirection={wide ? "row" : "column"} gap={1} marginTop={1}>
        <box width={wide ? contextWidth : "100%"} height={wide ? "100%" : 8} borderStyle="single" borderColor="#5b4c2d" flexDirection="column" padding={1} justifyContent="center" overflow="hidden">
          <text fg="#d8b45d">{`AYAH ${verseKey}`}</text>
          <ArabicBlock value={verseText} width={Math.max(12, contextTextWidth - 4)} bold />
          <text fg="#aeb8b6" wrapMode="word">{translation}</text>
        </box>
        <box flexGrow={1} height={wide ? "100%" : undefined} borderStyle="single" borderColor="#29404d" flexDirection="column" padding={1} overflow="hidden">
          <text fg="#62c2b8">{tafsirRow && typeof tafsirRow.raw.resourceName === "string" ? tafsirRow.raw.resourceName : "COMMENTARY"}</text>
          <scrollbox ref={scrollRef} flexGrow={1} width="100%" scrollY={true} viewportCulling={true} scrollbarOptions={{ visible: true }}>
            {!snapshot && <text fg="#60727a">Loading attributed commentary…</text>}
            {snapshot && !tafsirRow?.text && <text fg="#60727a">No commentary is available from the selected source for this ayah.</text>}
            {tafsirRow?.text && (
              <box flexDirection="column">
                {Array.isArray(tafsirRow.raw.coveredVerseKeys) && tafsirRow.raw.coveredVerseKeys.length > 1 && (
                  <text fg="#60727a">{`Commentary covers ${String(tafsirRow.raw.coveredVerseKeys[0])}–${String(tafsirRow.raw.coveredVerseKeys.at(-1))}`}</text>
                )}
                {tafsirBlocks
                  ? tafsirBlocks.map((block, index) => block.direction === "rtl"
                    ? <ArabicBlock key={`tafsir-block-${index}`} value={block.text} width={Math.max(16, Math.min(52, contentWidth - 8))} marginBottom={1} />
                    : <text key={`tafsir-block-${index}`} fg="#b8c3be" marginBottom={1}>{displayBlock(block)}</text>)
                  : tafsirRow.direction === "rtl" || tafsirRow.language === "ar"
                    ? <ArabicBlock value={tafsirRow.text ?? ""} width={Math.max(16, Math.min(52, contentWidth - 8))} />
                    : <text fg="#b8c3be">{displayText(tafsirRow)}</text>}
                <ResourceAttribution row={tafsirRow} compact />
              </box>
            )}
            {(snapshot?.topics.length ?? 0) > 0 && snapshot!.topics.map((row, index) => (
              <box key={`${row.provenance?.packId ?? "topic"}-${index}`} flexDirection="column" marginTop={1}>
                <text fg="#6f8b91">{`TOPIC · ${displayText(row, row.topic ?? row.text ?? "Untitled")}`}</text>
              </box>
            ))}
            {(snapshot?.words.length ?? 0) > 0 && snapshot!.words.slice(0, 5).map((row, index) => (
              <box key={`${row.wordKey ?? "word"}-${row.provenance?.packId ?? index}`} flexDirection="column" marginTop={1}>
                <text fg="#7797a5">{`WORD · ${displayText(row, row.text ?? "word")}${row.root ? ` · ROOT ${displayText(row, row.root)}` : ""}`}</text>
              </box>
            ))}
          </scrollbox>
        </box>
      </box>
    </box>
  );
}

function HadithPanel({
  value,
  verseKey,
  verseText,
  verseTranslation,
  width,
  height,
  overlay = false,
  loadingMore,
  onLoadMore,
}: {
  readonly value: HadithPage | null;
  readonly verseKey: string;
  readonly verseText: string;
  readonly verseTranslation: string;
  readonly width: number;
  readonly height?: number;
  readonly overlay?: boolean;
  readonly loadingMore: boolean;
  readonly onLoadMore: () => void;
}) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  useEffect(() => scrollRef.current?.scrollTo(0), [verseKey]);
  useKeyboard((key) => {
    if (key.sequence === "[") { key.preventDefault(); key.stopPropagation(); scrollRef.current?.scrollBy(-5); }
    if (key.sequence === "]") { key.preventDefault(); key.stopPropagation(); scrollRef.current?.scrollBy(5); }
    if (key.sequence === "n" && value?.hasMore && !loadingMore) {
      key.preventDefault();
      key.stopPropagation();
      onLoadMore();
    }
  });
  const wide = width >= 78 && (height ?? 24) >= 18;
  const contextWidth = wide ? Math.max(28, Math.min(36, Math.floor((width - 5) * 0.3))) : Math.max(20, width - 4);
  const contentWidth = wide ? Math.max(28, width - contextWidth - 8) : Math.max(20, width - 4);
  const displayLines = (value: string): string[] => wrapTerminalWords(value, contentWidth);
  const isArabic = (value: string, direction?: "rtl" | "ltr"): boolean => direction === "rtl" || /[\u0600-\u06ff]/u.test(value);
  const sourceLabel = value?.source === "quran-foundation" ? "ONLINE · QURAN FOUNDATION" : "LOCAL PACK";
  const contextTextWidth = Math.max(16, contextWidth - 4);
  const position = overlay
    ? { position: "absolute" as const, top: 3, left: 2, zIndex: 155, backgroundColor: "#081017" }
    : { zIndex: 155, backgroundColor: "#081017" };
  const renderRecord = (record: HadithRecord) => (
    <box key={record.id} flexDirection="column" marginBottom={1}>
      <text fg="#62c2b8"><strong>{`${record.name} · Hadith ${record.hadithNumber}`}</strong></text>
      {record.texts.map((text, index) => (
        <box key={`${record.id}-${text.language}-${text.urn ?? index}`} flexDirection="column" marginTop={1}>
          {text.chapterTitle && (isArabic(text.chapterTitle)
            ? <ArabicBlock value={text.chapterTitle} width={Math.max(16, Math.min(52, contentWidth - 8))} fg="#8fa6a3" />
            : displayLines(text.chapterTitle).map((line, lineIndex) => <text key={`${record.id}-${text.language}-chapter-${lineIndex}`} fg="#6f8b91">{line}</text>))}
          {isArabic(text.body, text.direction)
            ? <ArabicBlock value={text.body} width={Math.max(16, Math.min(52, contentWidth - 8))} />
            : displayLines(text.body).map((line, lineIndex) => <text key={`${record.id}-${text.language}-body-${lineIndex}`} fg="#aeb8b6">{line}</text>)}
          {text.grades.length > 0 && <text fg="#7797a5">Grade</text>}
          {text.grades.map((grade, gradeIndex) => (
            <box key={`${record.id}-${text.language}-grade-${gradeIndex}`} flexDirection="column">
              {displayLines(grade.grade).map((line, lineIndex) => <text key={`${record.id}-${text.language}-grade-${gradeIndex}-${lineIndex}`} fg="#7797a5">{line}</text>)}
              {grade.gradedBy && displayLines(grade.gradedBy).map((line, lineIndex) => <text key={`${record.id}-${text.language}-grader-${gradeIndex}-${lineIndex}`} fg="#60727a">{line}</text>)}
            </box>
          ))}
        </box>
      ))}
      {displayLines(record.provenance.attribution).map((line, index) => <text key={`${record.id}-attribution-${index}`} fg="#60727a">{line}</text>)}
      {displayLines(record.provenance.license).map((line, index) => <text key={`${record.id}-license-${index}`} fg="#52646b">{line}</text>)}
    </box>
  );
  return (
    <box {...position} width={width} height={height} borderStyle="rounded" borderColor="#476672" flexDirection="column" padding={1}>
      <box height={1} width="100%" flexDirection="row" justifyContent="space-between">
        <text fg="#f1d77c"><strong>{`Related hadith · ${verseKey}`}</strong></text>
        <text fg="#78908d">{`${sourceLabel} · [/] scroll · h closes`}</text>
      </box>
      <box flexGrow={1} width="100%" flexDirection={wide ? "row" : "column"} gap={1} marginTop={1}>
        <box width={wide ? contextWidth : "100%"} height={wide ? "100%" : 9} borderStyle="single" borderColor="#29404d" flexDirection="column" padding={1} overflow="hidden">
          <text fg="#d8b45d">{`AYAH ${verseKey}`}</text>
          <ArabicBlock value={verseText} width={Math.max(12, contextTextWidth - 4)} bold />
          <text fg="#aeb8b6" wrapMode="word">{wrapTerminalWords(verseTranslation, Math.max(20, contextWidth - 4)).join("\n")}</text>
          <text fg="#7797a5" wrapMode="word">Only narrations explicitly linked to this ayah are shown. This is a curated, non-exhaustive study aid.</text>
        </box>
        <box flexGrow={1} height={wide ? "100%" : undefined} borderStyle="single" borderColor="#29404d" flexDirection="column" padding={1} overflow="hidden">
          <text fg="#62c2b8">NARRATIONS · ARABIC + ENGLISH</text>
          <scrollbox ref={scrollRef} flexGrow={1} width="100%" scrollY={true} viewportCulling={true} scrollbarOptions={{ visible: true }}>
            {!value && <text fg="#60727a">Loading explicitly related narrations…</text>}
            {(value?.records.length ?? 0) > 0
              ? value!.records.map(renderRecord)
              : value && <text fg="#60727a">No curated related hadith are currently available for this ayah.</text>}
            {value?.truncated && <text fg="#7797a5">Only twelve records remain visible at once to keep terminal memory bounded.</text>}
            {value?.hasMore && <text fg="#d8b45d">{loadingMore ? "Loading the next bounded page…" : "Press n to load the next 4 narrations"}</text>}
          </scrollbox>
        </box>
      </box>
    </box>
  );
}

function ImmersiveAppContent({ safeMode = false }: { safeMode?: boolean }) {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const layout = chooseReaderLayout(dimensions.width, dimensions.height);
  const [surahId, setSurahId] = useState(() => {
    const saved = Number(getPreference("selectedSurahId") ?? 1);
    return getSurah(saved) ? saved : 1;
  });
  const [verseId, setVerseId] = useState(() => {
    const savedSurah = Number(getPreference("selectedSurahId") ?? 1);
    const savedVerse = Number(getPreference("currentVerseId") ?? 1);
    return getSurah(savedSurah)?.verses[savedVerse - 1] ? savedVerse : 1;
  });
  const [mode, setMode] = useState<ReadingExperienceMode>("focus");
  const [reducedMotion, setReducedMotion] = useState(() => getPreference("reducedMotion") === "true");
  const [message, setMessage] = useState("A calm space for attentive reading");
  const [study, setStudy] = useState<StudySnapshot | null>(null);
  const [studySource, setStudySource] = useState<StudySource | null>(null);
  const [showStudy, setShowStudy] = useState(false);
  const [hadithPage, setHadithPage] = useState<HadithPage | null>(null);
  const [showHadith, setShowHadith] = useState(false);
  const [loadingMoreHadith, setLoadingMoreHadith] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const [imageRetry, setImageRetry] = useState(0);
  const [activeWordKey, setActiveWordKey] = useState<WordKey | null>(null);
  const [hasTimings, setHasTimings] = useState(false);
  const [playMode, setPlayMode] = useState(false);
  const [playbackVisual, setPlaybackVisual] = useState<PlaybackVisualState>(IDLE_PLAYBACK_VISUAL);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [onlineSourcesAccepted, setOnlineSourcesAccepted] = useState(
    () => safeMode || sharedOnlineSourcesAccepted(),
  );
  const [showSearch, setShowSearch] = useState(false);
  const searchOpenRef = useRef(false);
  const [terminalIllumination, setTerminalIllumination] = useState(false);
  const [gpuIllumination, setGpuIllumination] = useState(false);
  const [readingLayout, setReadingLayout] = useState<QuranReadingLayout>("ayah");
  const [scriptStyle, setScriptStyle] = useState<QuranScriptStyle>("uthmani");
  const [focusGlow, setFocusGlow] = useState(1);
  const focusTimeline = useTimeline({ duration: 180, loop: false, autoplay: false });
  useEffect(() => {
    const saved = getPreference("rtlStrategy") as RtlStrategy | null;
    setRtlStrategy(saved && RTL_STRATEGIES.includes(saved) ? saved : "reshaped_reversed");
  }, []);
  const studyFeature = useFeatureCommand<StudyService>("study");
  const playerFeature = useFeatureCommand<RecitationPlayer>("recitation");
  const recognitionFeature = useFeatureCommand<TilawaRecognizer>("recognition");
  const spatialFeature = useFeatureCommand<VisualBackdrop & { renderable: import("@opentui/core").Renderable }>("spatial-backdrop");
  const studyState = useFeatureState("study", !safeMode);
  const audioState = useFeatureState("recitation", !safeMode);
  const recognitionState = useFeatureState("recognition", !safeMode);
  const spatialState = useFeatureState("spatial-backdrop", !safeMode);
  const studyRef = useRef<StudyService | null>(null);
  const playerRef = useRef<RecitationPlayer | null>(null);
  const playModeRef = useRef(false);
  const playbackRequestRef = useRef(0);
  const preloadRequestRef = useRef(0);
  const navigationIntentRef = useRef<NavigationIntent>("manual");
  const backdropRef = useRef<(VisualBackdrop & { renderable: import("@opentui/core").Renderable }) | null>(null);
  const followRef = useRef<FollowCoordinator | null>(null);
  const timedRef = useRef<TimedRecitationSession | null>(null);
  const playbackSubscriptionRef = useRef<(() => void) | null>(null);
  const packDownloadRef = useRef<AbortController | null>(null);
  const timedRecitationRequestRef = useRef<AbortController | null>(null);
  const timedPreloadRequestRef = useRef<AbortController | null>(null);
  const clearTimedRecitationCacheRef = useRef<(() => void) | null>(null);
  const clearQuranFoundationClientRef = useRef<(() => void) | null>(null);
  const openStudyRef = useRef<AbortController | null>(null);
  const clearOpenStudyCacheRef = useRef<(() => void) | null>(null);
  const clearQuranFoundationTafsirCacheRef = useRef<(() => void) | null>(null);
  const hadithRequestRef = useRef<AbortController | null>(null);
  const clearHadithCacheRef = useRef<(() => void) | null>(null);
  const pageRequestRef = useRef<AbortController | null>(null);
  const clearPageCacheRef = useRef<(() => void) | null>(null);
  const spatialSurfaceRequestRef = useRef(0);
  const activePaneRef = useRef<"reader" | "study" | "hadith" | "image">("reader");
  const surah = getSurah(surahId)!;
  const verse = surah.verses[verseId - 1]!;
  const verseKey = `${surahId}:${verseId}` as const;
  const verseKeyRef = useRef<string>(verseKey);
  const navigationCursorRef = useRef<`${number}:${number}`>(verseKey);
  const onlineSourcesAcceptedRef = useRef(onlineSourcesAccepted);
  verseKeyRef.current = verseKey;
  navigationCursorRef.current = verseKey;
  onlineSourcesAcceptedRef.current = onlineSourcesAccepted;

  const setPlaybackFollowing = useCallback((enabled: boolean) => {
    playModeRef.current = enabled;
    setPlayMode(enabled);
  }, []);

  const capabilities: CapabilityState = {
    text: true,
    study: studyState.status === "ready",
    images: true,
    playback: audioState.status === "ready",
    timings: hasTimings,
    recognition: recognitionState.status === "ready",
    microphone: Boolean(Bun.which("ffmpeg")),
    spatial: spatialState.status === "ready" || terminalIllumination || gpuIllumination,
    reducedMotion,
    safeMode,
  };
  const presentation = presentationFor(mode, capabilities);

  useEffect(() => {
    if (safeMode || onlineSourcesAccepted) return;
    const acceptForSession = () => {
      setOnlineSourcesAccepted(true);
      setDialog(null);
      setMessage("Online Quran sources enabled for this immersive session");
    };
    setDialog({
      title: "Online sources for immersive mode",
      description: [
        "Immersive mode uses online Quran sources instead of probing QUL.",
        "Quran.com supplies Quran fonts and canonical related-hadith pages. Quran Foundation supplies credentialed tafsir, hadith, and timed recitation.",
        "Al Quran Cloud / Islamic Network supplies keyless Tafsir al-Muyassar, page, image, and audio fallbacks.",
        "Providers receive your IP and the requested ayah, page, font, or media. quran.sh sends no notes, bookmarks, history, account data, or telemetry.",
        "Heavy features remain lazy and memory-bounded until you open them.",
      ],
      choices: [{
        key: "o",
        label: "OK",
        action: () => { acceptOnlineSources(false); acceptForSession(); },
      }, {
        key: "d",
        label: "Don't show again",
        action: () => {
          acceptOnlineSources(true);
          acceptForSession();
        },
      }, {
        key: "c",
        label: "Cancel",
        action: () => renderer.destroy(),
      }],
      onDismiss: () => renderer.destroy(),
    });
  }, [onlineSourcesAccepted, renderer, safeMode]);

  useEffect(() => {
    setPreference("selectedSurahId", String(surahId));
    setPreference("currentVerseId", String(verseId));
  }, [surahId, verseId]);

  useEffect(() => {
    focusTimeline.pause();
    focusTimeline.resetItems();
    const duration = readerTransitionDuration(reducedMotion);
    if (duration === 0) { setFocusGlow(1); return; }
    setFocusGlow(0);
    focusTimeline.add({ progress: 0 }, {
      progress: 1,
      duration,
      ease: "outQuad",
      onUpdate: (animation) => setFocusGlow(Number(animation.targets[0]?.progress ?? 1)),
    }).restart();
    return () => { focusTimeline.pause(); focusTimeline.resetItems(); };
  }, [focusTimeline, reducedMotion, verseKey]);

  const navigateTo = useCallback((key: `${number}:${number}`, intent: NavigationIntent = "manual") => {
    if (key === navigationCursorRef.current) return;
    const [nextSurah, nextVerse] = key.split(":").map(Number);
    if (nextSurah && nextVerse && getSurah(nextSurah)?.verses[nextVerse - 1]) {
      timedRecitationRequestRef.current?.abort(new Error("Replaced by a newer ayah"));
      timedPreloadRequestRef.current?.abort(new Error("Replaced by a newer ayah"));
      playbackRequestRef.current++;
      navigationIntentRef.current = intent;
      navigationCursorRef.current = key;
      setSurahId(nextSurah);
      setVerseId(nextVerse);
    }
  }, []);

  const loadOnlineStudy = useCallback(async (key: string, requestedResourceId = selectedTafsirResourceId()) => {
    const run = async (): Promise<void> => {
      openStudyRef.current?.abort(new Error("Replaced by a newer online study request"));
      const controller = new AbortController();
      openStudyRef.current = controller;
      setMessage(`Loading attributed online study for ${key}…`);
      try {
        let officialFailure: string | null = null;
        try {
          const provider = await import("../features/study/quran-foundation-tafsir.ts");
          clearQuranFoundationTafsirCacheRef.current = provider.clearQuranFoundationTafsirCache;
          if (provider.hasQuranFoundationCredentials()) {
            const resources = await provider.fetchQuranFoundationTafsirResources("en", { signal: controller.signal });
            controller.signal.throwIfAborted();
            const resource = resources.find((candidate) => candidate.id === requestedResourceId
                && candidate.languageName.toLocaleLowerCase("en") === "english")
              ?? resources.find((candidate) => candidate.id === provider.DEFAULT_TAFSIR_RESOURCE_ID)
              ?? resources.find((candidate) => candidate.languageName.toLocaleLowerCase("en") === "english");
            if (!resource) throw new Error("Quran Foundation returned no readable English tafsir resource");
            const onlineSnapshot = await provider.fetchQuranFoundationTafsirSnapshot(resource, key, { signal: controller.signal });
            controller.signal.throwIfAborted();
            if (verseKeyRef.current !== key || activePaneRef.current !== "study") return;
            if (resource.id !== requestedResourceId) setPreference(SELECTED_TAFSIR_RESOURCE_KEY, String(resource.id));
            setStudy(onlineSnapshot);
            setStudySource("online");
            setShowImage(false);
            setShowStudy(true);
            setMessage(`${resource.translatedName} · official Quran Foundation source · W changes tafsir`);
            return;
          }
        } catch (cause) {
          if (controller.signal.aborted) throw cause;
          officialFailure = deepestErrorMessage(cause, "The selected Quran Foundation tafsir is unavailable");
        }
        const provider = await import("../features/study/open-provider.ts");
        clearOpenStudyCacheRef.current = provider.clearOpenStudyCache;
        const onlineSnapshot = await provider.fetchOpenStudySnapshot(key, { signal: controller.signal });
        controller.signal.throwIfAborted();
        if (verseKeyRef.current !== key || activePaneRef.current !== "study") return;
        setStudy(onlineSnapshot);
        setStudySource("online");
        setShowImage(false);
        setShowStudy(true);
        setMessage(officialFailure
          ? `${provider.OPEN_STUDY_PROVIDER.editionName} keyless fallback · ${officialFailure}`
          : `${provider.OPEN_STUDY_PROVIDER.editionName} · online source: ${provider.OPEN_STUDY_PROVIDER.name}`);
      } catch (cause) {
        if (controller.signal.aborted || verseKeyRef.current !== key || activePaneRef.current !== "study") return;
        const detail = deepestErrorMessage(cause, "Online study is unavailable");
        setMessage(`${detail} · the Quran reader remains available offline`);
        setDialog({
          title: "Online study unavailable",
          description: [detail, "Your Quran text and translation remain available offline."],
          choices: [{
            key: "r",
            label: "Retry online study",
            action: () => {
              setDialog(null);
              if (verseKeyRef.current === key) void run();
              else setMessage("The ayah changed · press w to load study for the current ayah");
            },
          }, {
            key: "c",
            label: "Continue reading",
            action: () => {
              setDialog(null);
              setShowStudy(false);
              setStudySource(null);
            },
          }],
        });
      } finally {
        if (openStudyRef.current === controller) openStudyRef.current = null;
      }
    };
    await run();
  }, []);

  const chooseTafsir = useCallback(async () => {
    if (safeMode) { setMessage("Online tafsir sources are off in safe mode"); return; }
    const run = async (): Promise<void> => {
      openStudyRef.current?.abort(new Error("Replaced by the tafsir resource picker"));
      const controller = new AbortController();
      openStudyRef.current = controller;
      activePaneRef.current = "study";
      setShowHadith(false);
      setMessage("Loading the Quran Foundation tafsir catalogue…");
      try {
        const provider = await import("../features/study/quran-foundation-tafsir.ts");
        clearQuranFoundationTafsirCacheRef.current = provider.clearQuranFoundationTafsirCache;
        if (!provider.hasQuranFoundationCredentials()) {
          setDialog({
            title: "Choose tafsir",
            description: [
              "Quran.com's browser proxy returned HTTP 403 without browser session context, so quran.sh does not copy browser cookies or depend on it.",
              "Set QF_CLIENT_ID and QF_CLIENT_SECRET for Quran Foundation's documented tafsir catalogue, or continue with the keyless Tafsir al-Muyassar source.",
            ],
            choices: [{
              key: "m",
              label: "Use Tafsir al-Muyassar",
              action: () => { setDialog(null); void loadOnlineStudy(verseKeyRef.current); },
            }, {
              key: "c",
              label: "Continue reading",
              action: () => { activePaneRef.current = "reader"; setDialog(null); setShowStudy(false); },
            }],
          });
          return;
        }
        const resources = (await provider.fetchQuranFoundationTafsirResources("en", { signal: controller.signal }))
          .filter((resource) => resource.languageName.toLocaleLowerCase("en") === "english")
          .sort((left, right) => left.id === provider.DEFAULT_TAFSIR_RESOURCE_ID ? -1 : right.id === provider.DEFAULT_TAFSIR_RESOURCE_ID ? 1 : left.translatedName.localeCompare(right.translatedName));
        controller.signal.throwIfAborted();
        if (resources.length === 0) throw new Error("Quran Foundation returned no English tafsir resources");
        const current = selectedTafsirResourceId() ?? provider.DEFAULT_TAFSIR_RESOURCE_ID;
        const pageSize = 7;
        const pageCount = Math.ceil(resources.length / pageSize);
        const showPage = (page: number): void => {
          const pageResources = resources.slice(page * pageSize, (page + 1) * pageSize);
          const choices: DialogChoice[] = pageResources.map((resource, index) => ({
            key: String(index + 1),
            label: `${resource.id === current ? "Current · " : ""}${resource.translatedName}`,
            detail: resource.authorName ?? resource.name,
            action: () => {
              setPreference(SELECTED_TAFSIR_RESOURCE_KEY, String(resource.id));
              setDialog(null);
              void loadOnlineStudy(verseKeyRef.current, resource.id);
            },
          }));
          if (page > 0) choices.push({ key: "b", label: "Previous resources", action: () => showPage(page - 1) });
          if (page + 1 < pageCount) choices.push({ key: "n", label: "Next resources", action: () => showPage(page + 1) });
          setDialog({
            title: "Choose tafsir",
            description: [
              "The selection is saved locally. Commentary loads only when the study pane is open.",
              `English resources · page ${page + 1} of ${pageCount}`,
            ],
            choices,
          });
        };
        showPage(0);
      } catch (cause) {
        if (controller.signal.aborted || activePaneRef.current !== "study") return;
        const detail = deepestErrorMessage(cause, "The tafsir catalogue is temporarily unavailable");
        setDialog({
          title: "Tafsir catalogue unavailable",
          description: [detail, "The keyless Tafsir al-Muyassar source remains available."],
          choices: [{
            key: "m",
            label: "Use Tafsir al-Muyassar",
            action: () => { setDialog(null); void loadOnlineStudy(verseKeyRef.current); },
          }, {
            key: "r",
            label: "Retry catalogue",
            action: () => { setDialog(null); void run(); },
          }, {
            key: "c",
            label: "Continue reading",
            action: () => { activePaneRef.current = "reader"; setDialog(null); setShowStudy(false); },
          }],
        });
      } finally {
        if (openStudyRef.current === controller) openStudyRef.current = null;
      }
    };
    await run();
  }, [loadOnlineStudy, safeMode]);

  const inspect = useCallback(async () => {
    if (showStudy) {
      openStudyRef.current?.abort(new Error("Study pane closed"));
      activePaneRef.current = "reader";
      setShowStudy(false);
      setMessage("Study pane closed; cached online rows remain bounded for this session");
      return;
    }
    if (safeMode) { setMessage("Safe mode keeps every optional subsystem off"); return; }
    activePaneRef.current = "study";
    hadithRequestRef.current?.abort(new Error("Study pane opened"));
    const requestedKey = verseKey;
    await loadOnlineStudy(requestedKey);
  }, [loadOnlineStudy, safeMode, showStudy, verseKey]);

  useEffect(() => {
    openStudyRef.current?.abort(new Error("Ayah changed while study data was loading"));
  }, [verseKey]);

  const openQuranComHadithPage = useCallback(async (key: string) => {
    if (verseKeyRef.current !== key) { setMessage("The ayah changed · press h for its related hadith"); return; }
    const url = quranComHadithUrl(key);
    activePaneRef.current = "reader";
    setShowHadith(false);
    try {
      const { openQuranDotComUrl } = await import("./utils/external-url.ts");
      if (verseKeyRef.current !== key) { setMessage("The ayah changed · press h for its related hadith"); return; }
      await openQuranDotComUrl(url);
      if (verseKeyRef.current === key) setMessage(`Opened Quran.com's related-hadith page for ${key}`);
    } catch (cause) {
      if (verseKeyRef.current !== key) return;
      setMessage(deepestErrorMessage(cause, `Visit ${url}`));
      setDialog({
        title: "Could not open the browser",
        description: [deepestErrorMessage(cause, "No system browser opener is available"), `Open this URL manually: ${url}`],
        choices: [{ key: "c", label: "Continue reading", action: () => setDialog(null) }],
      });
    }
  }, []);

  const loadOnlineHadith = useCallback(async (key: string, page = 1, append = false) => {
    hadithRequestRef.current?.abort(new Error("Replaced by a newer hadith request"));
    const controller = new AbortController();
    hadithRequestRef.current = controller;
    if (append) setLoadingMoreHadith(true);
    else setMessage(`Loading curated related hadith for ${key}…`);
    try {
      const provider = await import("../features/hadith/quran-foundation-provider.ts");
      clearHadithCacheRef.current = provider.clearQuranFoundationHadithCache;
      const nextPage = await provider.fetchQuranFoundationHadithPage(key, page, { signal: controller.signal });
      controller.signal.throwIfAborted();
      if (verseKeyRef.current !== key || activePaneRef.current !== "hadith") return;
      setHadithPage((current) => {
        if (!append || current?.verseKey !== key) return nextPage;
        const unique = new Map([...current.records, ...nextPage.records]
          .map((record) => [`${record.collection}:${record.hadithNumber}`, record]));
        return { ...nextPage, records: [...unique.values()].slice(-12), truncated: current.truncated || unique.size > 12 };
      });
      setShowStudy(false);
      setShowImage(false);
      setShowHadith(true);
      setMessage(nextPage.records.length > 0
        ? `Loaded ${nextPage.records.length} curated narration(s) from Quran Foundation · h closes`
        : "No curated related hadith are currently available for this ayah · h closes");
    } catch (cause) {
      if (controller.signal.aborted || verseKeyRef.current !== key || activePaneRef.current !== "hadith") return;
      const detail = deepestErrorMessage(cause, "Related hadith are temporarily unavailable");
      setMessage(`${detail} · Quran reading remains available`);
      setDialog({
        title: "Related hadith unavailable",
        description: [detail, "No reading history, notes, or surrounding ayat were sent."],
        choices: [{
          key: "r",
          label: "Retry official API",
          action: () => {
            setDialog(null);
            if (verseKeyRef.current === key) void loadOnlineHadith(key, page, append);
            else setMessage("The ayah changed · press h for its related hadith");
          },
        }, {
          key: "o",
          label: "Open Quran.com",
          detail: "Use Quran.com's canonical related-hadith page for this ayah.",
          action: () => { setDialog(null); void openQuranComHadithPage(key); },
        }, {
          key: "c",
          label: "Continue reading",
          action: () => { activePaneRef.current = "reader"; setDialog(null); setShowHadith(false); },
        }],
      });
    } finally {
      if (hadithRequestRef.current === controller) {
        hadithRequestRef.current = null;
        setLoadingMoreHadith(false);
      }
    }
  }, [openQuranComHadithPage]);

  const inspectHadith = useCallback(async () => {
    if (showHadith) {
      hadithRequestRef.current?.abort(new Error("Hadith panel closed"));
      activePaneRef.current = "reader";
      setShowHadith(false);
      setMessage("Hadith panel closed; reading position preserved");
      return;
    }
    if (safeMode) { setMessage("Related hadith sources are off in safe mode"); return; }
    activePaneRef.current = "hadith";
    openStudyRef.current?.abort(new Error("Hadith panel opened"));
    const requestedKey = verseKey;
    try {
      const provider = await import("../features/hadith/quran-foundation-provider.ts");
      if (verseKeyRef.current !== requestedKey || activePaneRef.current !== "hadith") return;
      if (provider.hasQuranFoundationCredentials()) {
        await loadOnlineHadith(requestedKey);
        return;
      }
    } catch {
      // The canonical Quran.com page is the zero-configuration path when the
      // credentialed in-reader provider cannot be loaded.
    }
    await openQuranComHadithPage(requestedKey);
  }, [loadOnlineHadith, openQuranComHadithPage, safeMode, showHadith, verseKey]);

  const loadMoreHadith = useCallback(() => {
    if (!hadithPage?.hasMore || hadithPage.source !== "quran-foundation" || loadingMoreHadith) return;
    void loadOnlineHadith(hadithPage.verseKey, hadithPage.page + 1, true);
  }, [hadithPage, loadOnlineHadith, loadingMoreHadith]);

  useEffect(() => {
    hadithRequestRef.current?.abort(new Error("Ayah changed while hadith data was loading"));
    if (activePaneRef.current === "hadith") {
      activePaneRef.current = "reader";
      setDialog(null);
      setShowHadith(false);
      setHadithPage(null);
      setMessage("Ayah changed · press h for its related hadith");
    }
  }, [verseKey]);

  const preloadFollowingAyah = useCallback(async (currentKey: string, player: RecitationPlayer) => {
    const [currentSurah, currentVerse] = currentKey.split(":").map(Number);
    if (!currentSurah || !currentVerse) return;
    const nextKey = adjacentVerseKey(currentSurah, currentVerse, 1);
    const request = ++preloadRequestRef.current;
    if (!nextKey) {
      player.clearPreload?.();
      return;
    }
    if (onlineSourcesAcceptedRef.current) {
      timedPreloadRequestRef.current?.abort(new Error("Replaced by a newer timed preload"));
      const controller = new AbortController();
      timedPreloadRequestRef.current = controller;
      try {
        const client = await import("../features/quran-foundation/client.ts");
        clearQuranFoundationClientRef.current = client.clearQuranFoundationClient;
        if (client.hasQuranFoundationCredentials()) {
          const provider = await import("../features/audio/quran-foundation-recitation.ts");
          clearTimedRecitationCacheRef.current = provider.clearQuranFoundationTimedRecitationCache;
          const row = await provider.fetchQuranFoundationTimedRecitation(nextKey, { signal: controller.signal });
          if (controller.signal.aborted || request !== preloadRequestRef.current || !playModeRef.current || !row.audioUrl) return;
          networkPlaybackIdentity(row.audioUrl, row);
          await player.preload?.(nextKey, row.audioUrl);
          return;
        }
      } catch {
        if (controller.signal.aborted || request !== preloadRequestRef.current || !playModeRef.current) return;
        // Fall through to the installed ayah-level source when timed preloading is unavailable.
      } finally {
        if (timedPreloadRequestRef.current === controller) timedPreloadRequestRef.current = null;
      }
    }
    try {
      const service = studyRef.current ?? await studyFeature.activate();
      if (request !== preloadRequestRef.current || !playModeRef.current) return;
      studyRef.current = service;
      const rows = await service.recitation(nextKey);
      const row = rows.find((candidate) => candidate.audioUrl);
      const url = row?.audioUrl;
      if (!url || request !== preloadRequestRef.current || !playModeRef.current) return;
      networkPlaybackIdentity(url, row);
      await player.preload?.(nextKey, url);
    } catch {
      // Preloading is opportunistic; normal playback retains its own bounded retry path.
    }
  }, [studyFeature]);

  const startPlayback = useCallback(async (
    requestedKey: string,
    rows: Awaited<ReturnType<StudyService["recitation"]>>,
    url: string,
    playbackRequest: number,
  ) => {
    try { networkPlaybackIdentity(url, rows.find((row) => row.audioUrl === url)); }
    catch (cause) { throw new Error(deepestErrorMessage(cause, "Blocked invalid audio URL"), { cause }); }
    const begin = async () => {
      const isCurrentRequest = () => playbackRequestRef.current === playbackRequest && verseKeyRef.current === requestedKey;
      if (!isCurrentRequest()) return;
      await followRef.current?.stop();
      if (!isCurrentRequest()) return;
      followRef.current = null;
      const player = playerRef.current ?? await playerFeature.activate();
      if (!isCurrentRequest()) return;
      playerRef.current = player;
      timedRef.current?.dispose();
      timedRef.current = null;
      setActiveWordKey(null);
      const [{ createTimedRecitationSession }, { wordTimingsFromSegments }] = await Promise.all([
        import("../features/audio/timed-session.ts"),
        import("../features/resources/timing.ts"),
      ]);
      if (!isCurrentRequest()) return;
      const timings = wordTimingsFromSegments(requestedKey, rows.flatMap((row) => row.segments ?? []));
      const timingsValid = Boolean(timings);
      const durationMs = playbackDuration(rows);
      setHasTimings(timingsValid);
      setPlaybackVisual({ status: "loading", elapsedMs: 0, bufferedMs: 0, durationMs });
      const timed = createTimedRecitationSession(player, (key) => key === requestedKey ? timings : null);
      timed.subscribe((state) => setActiveWordKey(state.wordKey));
      timedRef.current = timed;
      playbackSubscriptionRef.current?.();
      let unsubscribePlayback = () => {};
      unsubscribePlayback = player.subscribe((state) => {
        if (!("verseKey" in state) || state.verseKey !== requestedKey || !isCurrentRequest()) return;
        if (state.status === "playing" || state.status === "buffering") {
          setPlaybackVisual(playbackVisualFrom(state, durationMs));
        }
        if (state.status === "ended" && playModeRef.current) {
          unsubscribePlayback();
          if (playbackSubscriptionRef.current === unsubscribePlayback) playbackSubscriptionRef.current = null;
          timedRef.current?.dispose();
          timedRef.current = null;
          setActiveWordKey(null);
          setHasTimings(false);
          setPlaybackVisual(IDLE_PLAYBACK_VISUAL);
          const [currentSurah, currentVerse] = requestedKey.split(":").map(Number);
          const nextKey = currentSurah && currentVerse ? adjacentVerseKey(currentSurah, currentVerse, 1) : null;
          if (nextKey) {
            setMessage(`Completed ${requestedKey} · continuing with ${nextKey}…`);
            navigateTo(nextKey, "completion");
          } else {
            preloadRequestRef.current++;
            setPlaybackFollowing(false);
            player.clearPreload?.();
            setMessage(`Completed ${requestedKey} · reached the end of the Quran`);
          }
          return;
        }
        if (state.status !== "error") return;
        unsubscribePlayback();
        if (playbackSubscriptionRef.current === unsubscribePlayback) playbackSubscriptionRef.current = null;
        preloadRequestRef.current++;
        setPlaybackFollowing(false);
        player.clearPreload?.();
        timedRef.current?.dispose();
        timedRef.current = null;
        setActiveWordKey(null);
        setHasTimings(false);
        setPlaybackVisual(IDLE_PLAYBACK_VISUAL);
        setMessage(`${state.message} · playback stopped at ${requestedKey}`);
        setDialog({
          title: "Audio stream unavailable",
          description: [state.message, `Playback stopped at ${requestedKey}; no earlier stream remains active.`],
          choices: [{
            key: "r",
            label: "Retry this ayah",
            action: () => { setDialog(null); void begin(); },
          }, {
            key: "c",
            label: "Continue reading",
            action: () => { setDialog(null); setMessage("Playback remains off; reading position preserved"); },
          }],
        });
      });
      playbackSubscriptionRef.current = unsubscribePlayback;
      if (!isCurrentRequest()) {
        timed.dispose();
        if (timedRef.current === timed) timedRef.current = null;
        setPlaybackVisual(IDLE_PLAYBACK_VISUAL);
        return;
      }
      setPlaybackFollowing(true);
      await player.play(requestedKey, url);
      if (!isCurrentRequest() || !playModeRef.current) return;
      setMessage(timingsValid ? `Following ${requestedKey} with verified word timing · next ayah preloading` : `Following ${requestedKey} at ayah level · next ayah preloading`);
      void preloadFollowingAyah(requestedKey, player);
    };
    if (playbackRequestRef.current !== playbackRequest || verseKeyRef.current !== requestedKey) return;
    await begin();
  }, [navigateTo, playerFeature, preloadFollowingAyah, setPlaybackFollowing]);

  const playRowsWithOptionalTiming = useCallback(async function playWithTiming(
    requestedKey: string,
    rows: Awaited<ReturnType<StudyService["recitation"]>>,
    fallbackUrl: string,
    playbackRequest: number,
  ): Promise<void> {
    const isCurrentRequest = () => playbackRequestRef.current === playbackRequest && verseKeyRef.current === requestedKey;
    if (!isCurrentRequest()) return;
    if (rows.some((row) => (row.segments?.length ?? 0) > 0)) {
      await startPlayback(requestedKey, rows, fallbackUrl, playbackRequest);
      return;
    }

    const client = await import("../features/quran-foundation/client.ts");
    clearQuranFoundationClientRef.current = client.clearQuranFoundationClient;
    if (!isCurrentRequest() || !client.hasQuranFoundationCredentials()) {
      await startPlayback(requestedKey, rows, fallbackUrl, playbackRequest);
      return;
    }

    if (!onlineSourcesAcceptedRef.current) {
      await startPlayback(requestedKey, rows, fallbackUrl, playbackRequest);
      return;
    }

    timedRecitationRequestRef.current?.abort(new Error("Replaced by a newer timed-recitation request"));
    const controller = new AbortController();
    timedRecitationRequestRef.current = controller;
    setMessage(`Loading verified word timing for ${requestedKey}…`);
    try {
      const provider = await import("../features/audio/quran-foundation-recitation.ts");
      clearTimedRecitationCacheRef.current = provider.clearQuranFoundationTimedRecitationCache;
      const timedRow = await provider.fetchQuranFoundationTimedRecitation(requestedKey, { signal: controller.signal });
      if (!isCurrentRequest() || controller.signal.aborted || !timedRow.audioUrl) return;
      await startPlayback(requestedKey, [timedRow], timedRow.audioUrl, playbackRequest);
    } catch (cause) {
      if (!isCurrentRequest() || controller.signal.aborted) return;
      setMessage(`${deepestErrorMessage(cause, "Verified word timing is unavailable")} · continuing at ayah level`);
      await startPlayback(requestedKey, rows, fallbackUrl, playbackRequest);
    } finally {
      if (timedRecitationRequestRef.current === controller) timedRecitationRequestRef.current = null;
    }
  }, [startPlayback]);

  const installStarterPackAndPlay = useCallback(async () => {
    if (packDownloadRef.current) {
      setMessage("The recitation pack is already downloading");
      return;
    }
    const controller = new AbortController();
    const requestedKey = verseKey;
    const playbackRequest = ++playbackRequestRef.current;
    packDownloadRef.current = controller;
    const cancel = () => {
      controller.abort(new Error("Cancelled by the reader"));
      setMessage("Cancelling the recitation-pack download…");
    };
    setDialog({
      title: "Downloading recitation pack",
      description: ["Starting the bounded, checksum-pinned download…"],
      choices: [{ key: "c", label: "Cancel download", action: cancel }],
      onDismiss: cancel,
    });
    setMessage(`Downloading the ${STARTER_RECITATION_PACK.provider} streaming index…`);
    try {
      const { installStarterRecitationPack } = await import("../features/resources/public-recitation.ts");
      await installStarterRecitationPack(APP_DATA_DIR, {
        signal: controller.signal,
        onProgress: (received, total) => {
          const progress = `${Math.round(received / 1024)}${total ? `/${Math.round(total / 1024)}` : ""} KiB`;
          setMessage(`Downloading recitation index · ${progress}`);
          setDialog({
            title: "Downloading recitation pack",
            description: [`Received ${progress}. Verification and indexing follow automatically.`],
            choices: [{ key: "c", label: "Cancel download", action: cancel }],
            onDismiss: cancel,
          });
        },
      });
      controller.signal.throwIfAborted();
      await studyFeature.disable();
      studyRef.current = null;
      const service = await studyFeature.activate();
      controller.signal.throwIfAborted();
      studyRef.current = service;
      const rows = await service.recitation(requestedKey);
      if (playbackRequestRef.current !== playbackRequest || verseKeyRef.current !== requestedKey) return;
      const url = rows.find((row) => row.audioUrl)?.audioUrl;
      if (!url) throw new Error("The pack installed but this ayah has no audio mapping. Run `quran resources verify islamic-network.alafasy-128`.");
      setMessage("Recitation index installed and verified");
      setDialog(null);
      await playRowsWithOptionalTiming(requestedKey, rows, url, playbackRequest);
    } catch (cause) {
      const cancelled = controller.signal.aborted || (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "cancelled");
      if (cancelled) {
        setDialog(null);
        setMessage("Recitation-pack download cancelled; press p whenever you are ready to retry");
        return;
      }
      const detail = cause instanceof Error ? cause.message : "The recitation pack could not be installed";
      setMessage(detail);
      setDialog({
        title: "Download did not finish",
        description: [detail, "Check the connection and retry here, or run `quran resources install starter-audio` later."],
        choices: [{ key: "r", label: "Retry download", action: () => void installStarterPackAndPlay() }],
      });
    } finally {
      if (packDownloadRef.current === controller) packDownloadRef.current = null;
    }
  }, [playRowsWithOptionalTiming, studyFeature, verseKey]);

  const playVerse = useCallback(async (requestedKey: string, offerPack: boolean) => {
    if (safeMode) { setMessage("Playback is off in safe mode"); return; }
    const playbackRequest = ++playbackRequestRef.current;
    try {
      const service = studyRef.current ?? await studyFeature.activate();
      if (playbackRequestRef.current !== playbackRequest || verseKeyRef.current !== requestedKey) return;
      studyRef.current = service;
      const rows = await service.recitation(requestedKey);
      if (playbackRequestRef.current !== playbackRequest || verseKeyRef.current !== requestedKey) return;
      const url = rows.find((row) => row.audioUrl)?.audioUrl;
      if (!url) {
        if (!offerPack) {
          setPlaybackFollowing(false);
          playerRef.current?.clearPreload?.();
          playbackSubscriptionRef.current?.();
          playbackSubscriptionRef.current = null;
          setDialog({
            title: "Playback paused",
            description: [`The installed recitation source has no audio mapping for ${requestedKey}.`, "The reader stayed on the requested ayah and stopped every previous stream."],
            choices: [
              { key: "r", label: "Retry current ayah", action: () => { setDialog(null); void playVerse(requestedKey, false); } },
              { key: "s", label: "Stop play mode", action: () => { setDialog(null); setMessage("Playback stopped; reading position preserved"); } },
            ],
          });
          return;
        }
        setDialog({
          title: "Download a recitation pack?",
          description: [
            `${STARTER_RECITATION_PACK.reciter} · 128 kbps · ${STARTER_RECITATION_PACK.provider}`,
            "This downloads and verifies a ~607 KiB verse index. Audio streams only when you press play.",
            "Provider terms allow personal/educational, non-commercial listening; the reciter retains copyright.",
            "Playback remains ayah-level unless a compatible local timing pack or the optional Quran Foundation timed source is available.",
          ],
          choices: [{ key: "d", label: "Download pack", detail: "License and attribution are stored with the installed pack.", action: () => void installStarterPackAndPlay() }],
        });
        return;
      }
      await playRowsWithOptionalTiming(requestedKey, rows, url, playbackRequest);
    } catch (cause) {
      if (playbackRequestRef.current !== playbackRequest || verseKeyRef.current !== requestedKey) return;
      setPlaybackFollowing(false);
      playerRef.current?.clearPreload?.();
      playbackSubscriptionRef.current?.();
      playbackSubscriptionRef.current = null;
      const detail = cause instanceof Error ? cause.message : "Playback unavailable";
      setDialog({
        title: "Playback paused",
        description: [detail, "The current ayah remains selected and every earlier stream has been stopped."],
        choices: [
          { key: "r", label: "Retry current ayah", action: () => { setDialog(null); void playVerse(requestedKey, offerPack); } },
          { key: "s", label: "Stop play mode", action: () => { setDialog(null); setMessage("Playback stopped; reading position preserved"); } },
        ],
      });
    }
  }, [installStarterPackAndPlay, playRowsWithOptionalTiming, safeMode, setPlaybackFollowing, studyFeature]);

  const play = useCallback(() => playVerse(verseKey, true), [playVerse, verseKey]);

  const stopPlayback = useCallback(() => {
    playbackRequestRef.current++;
    preloadRequestRef.current++;
    timedRecitationRequestRef.current?.abort(new Error("Playback stopped"));
    timedPreloadRequestRef.current?.abort(new Error("Playback stopped"));
    setPlaybackFollowing(false);
    playerRef.current?.stop();
    playerRef.current?.clearPreload?.();
    playbackSubscriptionRef.current?.();
    playbackSubscriptionRef.current = null;
    timedRef.current?.dispose();
    timedRef.current = null;
    setActiveWordKey(null);
    setHasTimings(false);
    setPlaybackVisual(IDLE_PLAYBACK_VISUAL);
    setMessage("Playback stopped; reading position preserved");
  }, [setPlaybackFollowing]);

  useEffect(() => {
    if (!playModeRef.current) return;
    const intent = navigationIntentRef.current;
    navigationIntentRef.current = "manual";
    preloadRequestRef.current++;
    timedRecitationRequestRef.current?.abort(new Error("Ayah changed"));
    timedPreloadRequestRef.current?.abort(new Error("Ayah changed"));
    playerRef.current?.stop();
    playbackSubscriptionRef.current?.();
    playbackSubscriptionRef.current = null;
    if (intent === "manual") playerRef.current?.clearPreload?.();
    timedRef.current?.dispose();
    timedRef.current = null;
    setActiveWordKey(null);
    setHasTimings(false);
    setPlaybackVisual(IDLE_PLAYBACK_VISUAL);
    setMessage(intent === "completion" ? `Continuing with ${verseKey}…` : `Moving playback to ${verseKey}…`);
    if (intent === "completion") {
      void playVerse(verseKey, false);
      return;
    }
    const timer = setTimeout(() => void playVerse(verseKey, false), PLAYBACK_NAVIGATION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [playVerse, verseKey]);

  const buildReadingSurface = useCallback(async (
    requestedKey: `${number}:${number}`,
    targetLayout: QuranReadingLayout,
    targetScript: QuranScriptStyle,
    allowOnlinePage: boolean,
  ): Promise<QuranReadingSurface> => {
    const [requestedSurah, requestedAyah] = requestedKey.split(":").map(Number);
    const builtin = getSurah(requestedSurah!)?.verses[requestedAyah! - 1];
    if (!builtin) throw new Error(`Invalid Quran coordinate: ${requestedKey}`);

    if (targetLayout === "ayah" && targetScript !== "tajweed") {
      return {
        verseKey: requestedKey,
        layout: "ayah",
        script: targetScript,
        exactLineLayout: false,
        lines: [{ id: requestedKey, text: builtin.text, active: true }],
      };
    }

    if (targetLayout === "page" && targetScript === "uthmani") {
      if (!allowOnlinePage) throw new Error("ONLINE_PAGE_PERMISSION_REQUIRED");
      pageRequestRef.current?.abort(new Error("Replaced by a newer Quran page request"));
      const controller = new AbortController();
      pageRequestRef.current = controller;
      const provider = await import("../features/spatial/open-page-provider.ts");
      clearPageCacheRef.current = provider.clearOpenQuranPageCache;
      let openPage;
      try { openPage = await provider.fetchOpenQuranPage(requestedKey, { signal: controller.signal }); }
      finally { if (pageRequestRef.current === controller) pageRequestRef.current = null; }
      return {
        verseKey: requestedKey,
        layout: "page",
        script: "uthmani",
        page: openPage.page,
        exactLineLayout: false,
        lines: pageFlowLines(openPage.verses, requestedKey),
      };
    }

    const service = studyRef.current ?? await studyFeature.activate();
    studyRef.current = service;
    const [snapshot, scriptRows] = await Promise.all([
      service.inspect(requestedKey),
      service.script?.(requestedKey) ?? Promise.resolve([]),
    ]);
    const localVerseRows = coherentVerseRows(scriptRows, requestedKey, targetScript);
    const mushafRow = snapshot.mushaf.find((row) => row.page && row.line && row.provenance) ?? null;
    const scriptPage = localVerseRows.length > 0 && localVerseRows.every((row) => row.page === localVerseRows[0]?.page)
      ? localVerseRows[0]?.page
      : undefined;
    const page = scriptPage ?? mushafRow?.page;
    const selectedAyahText = [...localVerseRows]
      .sort((left, right) => wordPosition(left) - wordPosition(right))
      .map((row) => resourceText(row, targetScript))
      .filter((text): text is string => Boolean(text))
      .join(" ");

    if (targetLayout === "ayah") {
      if (targetScript === "tajweed" && (!selectedAyahText || !page)) {
        throw new Error("Verified Tajweed needs a local QCF V4 quran-script pack with code_v2 glyphs and page numbers");
      }
      return {
        verseKey: requestedKey,
        layout: "ayah",
        script: targetScript,
        page,
        exactLineLayout: Boolean(selectedAyahText),
        lines: [{
          id: requestedKey,
          text: selectedAyahText || builtin.text,
          active: true,
        }],
      };
    }

    if (page && service.mushafPage && service.scriptPage) {
      const [layoutRows, pageScriptRows] = await Promise.all([service.mushafPage(page), service.scriptPage(page)]);
      const lines = exactLocalPageLines(pageScriptRows, layoutRows, page, requestedKey, targetScript);
      if (lines) {
        return { verseKey: requestedKey, layout: "page", script: targetScript, page, exactLineLayout: true, lines };
      }
    }

    if (targetScript !== "uthmani") {
      throw new Error(`${targetScript === "tajweed" ? "Tajweed" : "IndoPak"} page mode needs a compatible local QUL quran-script and mushaf-layout pack`);
    }
    throw new Error("The requested Quran page source is unavailable");
  }, [studyFeature]);

  const applyReadingSurface = useCallback(async (
    requestedKey: `${number}:${number}`,
    targetLayout: QuranReadingLayout,
    targetScript: QuranScriptStyle,
    allowOnlinePage: boolean,
  ): Promise<QuranReadingSurface> => {
    const request = ++spatialSurfaceRequestRef.current;
    const surface = await buildReadingSurface(requestedKey, targetLayout, targetScript, allowOnlinePage);
    if (request !== spatialSurfaceRequestRef.current || verseKeyRef.current !== requestedKey || !backdropRef.current) return surface;
    await backdropRef.current.setReadingSurface(surface);
    if (request !== spatialSurfaceRequestRef.current || verseKeyRef.current !== requestedKey) return surface;
    setReadingLayout(targetLayout);
    setScriptStyle(targetScript);
    const fidelity = surface.exactLineLayout ? "verified local layout" : targetLayout === "page" ? "canonical page · adaptive line flow" : "vector ayah";
    setMessage(`${targetScript.toLocaleUpperCase()} ${targetLayout} reader · ${fidelity} · actual RTL glyph outlines`);
    return surface;
  }, [buildReadingSurface]);

  const handleImageError = useCallback((detail: string) => {
    setDialog({
      title: "Ayah image unavailable",
      description: [detail, "The live Quran text remains available and keeps the same reading position."],
      choices: [{
        key: "r",
        label: "Retry image",
        action: () => { setDialog(null); setImageRetry((value) => value + 1); },
      }, {
        key: "t",
        label: "Return to terminal text",
        action: () => { setDialog(null); setShowImage(false); setMessage("Using the built-in Quran text; no image was loaded"); },
      }],
    });
  }, []);

  const openImage = useCallback(() => {
    activePaneRef.current = "image";
    openStudyRef.current?.abort(new Error("Image pane opened"));
    hadithRequestRef.current?.abort(new Error("Image pane opened"));
    setShowStudy(false);
    setShowHadith(false);
    setShowImage(true);
    setImageRetry((value) => value + 1);
    setMessage("Loading the attributed online ayah image · i returns to terminal text");
  }, []);

  const requestImage = useCallback(() => {
    if (safeMode) { setMessage("Online images are off in safe mode"); return; }
    openImage();
  }, [openImage, safeMode]);

  const toggleImage = useCallback(() => {
    if (!showImage) {
      requestImage();
      return;
    }
    activePaneRef.current = "reader";
    setShowImage(false);
    setMessage("Online image view closed; reading position preserved");
  }, [requestImage, showImage]);

  const enableSpatial = useCallback(async () => {
    let activated: (VisualBackdrop & { renderable: import("@opentui/core").Renderable }) | null = null;
    let attached = false;
    let rendererReady = false;
    try {
      const backdrop = await spatialFeature.activate();
      activated = backdrop;
      renderer.root.add(backdrop.renderable, 0);
      attached = true;
      backdrop.setReducedMotion(reducedMotion);
      backdrop.setVerse(verseKey, verseId / surah.totalVerses);
      backdrop.setMushafContext(null);
      backdropRef.current = backdrop;
      setTerminalIllumination(false);
      setGpuIllumination(true);
      rendererReady = true;
      await applyReadingSurface(verseKey, readingLayout, scriptStyle, true);
    } catch (cause) {
      let removalFailure: unknown;
      if (attached && activated) {
        try { renderer.root.remove(activated.renderable); }
        catch (error) { removalFailure = error; }
      }
      backdropRef.current = null;
      setGpuIllumination(false);
      let cleanupFailure: unknown;
      await spatialFeature.disable().catch((error) => { cleanupFailure = error; });
      const reason = deepestErrorMessage(cause, "WebGPU device unavailable");
      const cleanupErrors = [removalFailure, cleanupFailure]
        .filter((error) => error !== undefined)
        .map((error) => deepestErrorMessage(error, "unknown finalizer error"));
      const cleanup = cleanupErrors.length > 0 ? ` Cleanup also failed: ${cleanupErrors.join("; ")}` : "";
      const diagnosis = rendererReady
        ? {
          summary: `OpenTUI Three started, but the Quran reading surface could not load: ${reason}`,
          steps: [
            "This is a font or reading-data failure, not a Metal device failure.",
            "Retry the Quran surface, keep the live terminal reader, or use the optional ayah image.",
          ],
        }
        : await import("../features/spatial/diagnostics.ts").then(({ diagnoseWebGpuFailure }) => diagnoseWebGpuFailure(reason));
      setDialog({
        title: rendererReady ? "3D Quran text unavailable" : "OpenTUI Three unavailable",
        description: [`${diagnosis.summary}${cleanup}`, ...diagnosis.steps],
        choices: [
          {
            key: "f",
            label: "Use terminal illumination",
            detail: "A lightweight terminal-cell design with no GPU or native dependency.",
            action: () => { setDialog(null); setGpuIllumination(false); setTerminalIllumination(true); setMessage("Terminal arch illumination on · it follows the active ayah · g turns it off"); },
          },
          { key: "r", label: rendererReady ? "Retry Quran surface" : "Retry OpenTUI Three", detail: rendererReady ? "Retries the Quran font and reading data at this ayah." : "Useful after changing drivers or the terminal session.", action: () => { setDialog(null); void enableSpatial(); } },
          { key: "i", label: "Use online ayah image", detail: "A bounded Braille image view that needs no WebGPU device.", action: () => { setDialog(null); requestImage(); } },
        ],
      });
    }
  }, [applyReadingSurface, readingLayout, reducedMotion, renderer, requestImage, scriptStyle, spatialFeature, surah.totalVerses, verseId, verseKey]);

  const toggleSpatial = useCallback(async () => {
    if (safeMode) { setMessage("Spatial rendering is off in safe mode"); return; }
    if (backdropRef.current || terminalIllumination || gpuIllumination) {
      let removalFailure: unknown;
      if (backdropRef.current) {
        try { renderer.root.remove(backdropRef.current.renderable); }
        catch (error) { removalFailure = error; }
      }
      backdropRef.current = null;
      setTerminalIllumination(false);
      setGpuIllumination(false);
      try {
        await spatialFeature.disable();
        setMessage(removalFailure
          ? `Spatial GPU resources were released, but surface removal failed: ${deepestErrorMessage(removalFailure, "unknown surface error")}. Restart quran.sh before retrying.`
          : "Spatial illumination off");
      } catch (cause) {
        const removal = removalFailure ? ` Surface removal also failed: ${deepestErrorMessage(removalFailure, "unknown surface error")}.` : "";
        setMessage(`GPU cleanup failed: ${deepestErrorMessage(cause, "unknown finalizer error")}.${removal} Restart quran.sh before retrying.`);
      }
      return;
    }
    await enableSpatial();
  }, [enableSpatial, gpuIllumination, renderer, safeMode, spatialFeature, terminalIllumination]);

  const toggleReadingLayout = useCallback(async () => {
    if (!backdropRef.current) {
      setMessage("Page and ayah surfaces are part of the 3D reader · press g to enable it first");
      return;
    }
    const nextLayout: QuranReadingLayout = readingLayout === "ayah" ? "page" : "ayah";
    const load = async () => {
      try { await applyReadingSurface(verseKey, nextLayout, scriptStyle, true); }
      catch (cause) {
        let detail = deepestErrorMessage(cause, "The requested Quran surface is unavailable");
        if (nextLayout === "page" && scriptStyle !== "uthmani") {
          try {
            await applyReadingSurface(verseKey, "page", "uthmani", true);
            setMessage(`${detail} · continued with the online Uthmani page`);
            return;
          } catch (fallbackCause) {
            detail = `${detail} · ${deepestErrorMessage(fallbackCause, "The online Uthmani page is also unavailable")}`;
          }
        }
        setDialog({
          title: "Online Quran page unavailable",
          description: [detail, "The live Uthmani ayah reader remains available at the same position."],
          choices: [{
            key: "u",
            label: "Use Uthmani ayah",
            action: () => { setDialog(null); void applyReadingSurface(verseKey, "ayah", "uthmani", false); },
          }, {
            key: "r",
            label: "Retry page",
            action: () => { setDialog(null); void load(); },
          }, {
            key: "c",
            label: "Keep current surface",
            action: () => setDialog(null),
          }],
        });
      }
    };
    await load();
  }, [applyReadingSurface, readingLayout, scriptStyle, verseKey]);

  const cycleScriptStyle = useCallback(async () => {
    if (!backdropRef.current) {
      setMessage("Quran script faces are part of the 3D reader · press g to enable it first");
      return;
    }
    const nextScript: QuranScriptStyle = scriptStyle === "uthmani" ? "indopak" : scriptStyle === "indopak" ? "tajweed" : "uthmani";
    try {
      await applyReadingSurface(verseKey, readingLayout, nextScript, true);
    } catch (cause) {
      const detail = deepestErrorMessage(cause, `${nextScript} rendering is unavailable`);
      try {
        await applyReadingSurface(verseKey, "ayah", "uthmani", false);
        setMessage(`${detail} · continued with the built-in Uthmani ayah`);
      } catch (fallbackCause) {
        setMessage(deepestErrorMessage(fallbackCause, "The Uthmani ayah reader is temporarily unavailable"));
      }
    }
  }, [applyReadingSurface, readingLayout, scriptStyle, verseKey]);

  const toggleFollow = useCallback(async () => {
    if (followRef.current) {
      await followRef.current.stop();
      followRef.current = null;
      setMessage("Listening stopped; microphone and model session released");
      return;
    }
    if (safeMode) { setMessage("Microphone is off in safe mode"); return; }
    if (getPreference("followDisclosureAccepted") !== "true") {
      setDialog({
        title: "Start local follow mode?",
        description: [
          "Follow mode captures the microphone for local inference; quran.sh does not retain the audio.",
          "It needs FFmpeg and the separately installed ~104 MiB Tilawa model.",
        ],
        choices: [{
          key: "y",
          label: "Allow microphone and start",
          action: () => { setDialog(null); setPreference("followDisclosureAccepted", "true"); void toggleFollow(); },
        }],
      });
      return;
    }
    try {
      stopPlayback();
      const [recognizer, { createFfmpegCapture }, { createFollowCoordinator }] = await Promise.all([
        recognitionFeature.activate(),
        import("../features/capture/ffmpeg-source.ts"),
        import("../features/recognition/follow-coordinator.ts"),
      ]);
      const follow = createFollowCoordinator({ capture: createFfmpegCapture(), recognizer, navigate: navigateTo });
      follow.subscribe((state) => {
        setActiveWordKey(state.word ?? null);
        setMessage(state.status === "listening"
          ? state.wordMapping === "ambiguous" || state.wordMapping === "unavailable"
            ? "Listening locally · word boundary is unverified, so highlighting stays at ayah level"
            : state.candidate ? `Listening · possible ${state.candidate} (${Math.round((state.confidence ?? 0) * 100)}%)` : "Listening locally · tentative results never move the reader"
          : state.finalSequence?.length ? `Review only · recognised ${state.finalSequence.join(" → ")} · reading history was not changed`
          : state.error ?? `Recognition ${state.status}`);
      });
      followRef.current = follow;
      await follow.start();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Follow mode unavailable"); }
  }, [navigateTo, recognitionFeature, safeMode, stopPlayback]);

  useEffect(() => {
    backdropRef.current?.setVerse(verseKey, verseId / surah.totalVerses);
    if (!showStudy || study?.verseKey === verseKey) return;
    void loadOnlineStudy(verseKey);
  }, [loadOnlineStudy, showStudy, study?.verseKey, surah.totalVerses, verseId, verseKey]);

  useEffect(() => {
    if (!backdropRef.current) return;
    void applyReadingSurface(verseKey, readingLayout, scriptStyle, true).catch((cause) => {
      if (verseKeyRef.current !== verseKey || !backdropRef.current) return;
      const detail = deepestErrorMessage(cause, "The spatial Quran surface could not follow this ayah");
      void applyReadingSurface(verseKey, "ayah", "uthmani", false).then(() => {
        setMessage(`${detail} · continued in Uthmani ayah mode`);
      }).catch((fallbackCause) => setMessage(deepestErrorMessage(fallbackCause, "The 3D Quran text is temporarily unavailable")));
    });
  // Surface style changes are applied by their explicit dialog-aware commands;
  // navigation is the only automatic transition this effect owns.
  }, [verseKey]);

  useEffect(() => {
    const coordinate = activeWordKey ? parseWordKey(activeWordKey) : null;
    backdropRef.current?.setActiveWord(coordinate?.key.startsWith(`${verseKey}:`) ? coordinate.word : null);
  }, [activeWordKey, gpuIllumination, verseKey]);

  useEffect(() => () => {
    packDownloadRef.current?.abort(new Error("Reader closed"));
    timedRecitationRequestRef.current?.abort(new Error("Reader closed"));
    timedPreloadRequestRef.current?.abort(new Error("Reader closed"));
    openStudyRef.current?.abort(new Error("Reader closed"));
    hadithRequestRef.current?.abort(new Error("Reader closed"));
    pageRequestRef.current?.abort(new Error("Reader closed"));
    clearOpenStudyCacheRef.current?.();
    clearQuranFoundationTafsirCacheRef.current?.();
    clearHadithCacheRef.current?.();
    clearPageCacheRef.current?.();
    clearTimedRecitationCacheRef.current?.();
    clearQuranFoundationClientRef.current?.();
    playerRef.current?.stop();
    playerRef.current?.clearPreload?.();
    playbackSubscriptionRef.current?.();
    playbackSubscriptionRef.current = null;
    timedRef.current?.dispose();
    void followRef.current?.stop();
    if (backdropRef.current?.renderable.parent) backdropRef.current.renderable.parent.remove(backdropRef.current.renderable);
  }, [renderer]);

  useKeyboard((key) => {
    if (dialog || searchOpenRef.current) return;
    if (key.sequence === "q") { renderer.destroy(); return; }
    if (key.sequence && ["1", "2", "3", "4"].includes(key.sequence)) { setMode(READING_MODES[Number(key.sequence) - 1]!); return; }
    if (key.sequence === "w") { setShowHadith(false); void inspect(); return; }
    if (key.sequence === "W") { void chooseTafsir(); return; }
    if (key.sequence === "h") { setShowStudy(false); void inspectHadith(); return; }
    if (key.sequence === "i") { toggleImage(); return; }
    if (key.sequence === "p") { if (playModeRef.current) stopPlayback(); else void play(); return; }
    if (key.sequence === "g") { void toggleSpatial(); return; }
    if (key.sequence === "r") { void toggleReadingLayout(); return; }
    if (key.sequence === "f") { void cycleScriptStyle(); return; }
    if (key.sequence === "v") { void toggleFollow(); return; }
    if (key.sequence === "/" || (key.ctrl && key.name === "f")) {
      searchOpenRef.current = true;
      openStudyRef.current?.abort(new Error("Study request cancelled while Quran search opened"));
      openStudyRef.current = null;
      hadithRequestRef.current?.abort(new Error("Hadith request cancelled while Quran search opened"));
      hadithRequestRef.current = null;
      setLoadingMoreHadith(false);
      setShowStudy(false);
      setShowHadith(false);
      setShowImage(false);
      activePaneRef.current = "reader";
      setShowSearch(true);
      return;
    }
    if (key.sequence === "M") {
      const next = !reducedMotion;
      setReducedMotion(next);
      setPreference("reducedMotion", String(next));
      backdropRef.current?.setReducedMotion(next);
      setMessage(next ? "Reduced motion on" : "Reduced motion off");
      return;
    }
    if (key.name === "down" || key.sequence === "j") {
      const [cursorSurah, cursorVerse] = navigationCursorRef.current.split(":").map(Number);
      const nextKey = adjacentVerseKey(cursorSurah!, cursorVerse!, 1);
      if (nextKey) navigateTo(nextKey);
    }
    if (key.name === "up" || key.sequence === "k") {
      const [cursorSurah, cursorVerse] = navigationCursorRef.current.split(":").map(Number);
      const previousKey = adjacentVerseKey(cursorSurah!, cursorVerse!, -1);
      if (previousKey) navigateTo(previousKey);
    }
  });

  const readerWidth = Math.max(32, Math.min(100, Math.floor(dimensions.width * (layout.mode === "compact" ? 0.96 : 0.86))));
  const lineWidth = Math.max(28, readerWidth - 4);
  const arabic = useMemo(() => renderArabicVerse(verse.text, 0, lineWidth), [lineWidth, verse.text]);
  const activeCoordinate = activeWordKey ? parseWordKey(activeWordKey) : null;
  const activeWordNumber = activeCoordinate?.key.startsWith(`${verseKey}:`) ? activeCoordinate.word : null;
  const activeRenderedRange = activeWordNumber
    ? renderedArabicWordRange(verse.text, arabic, activeWordNumber, lineWidth, getRtlStrategy() ?? undefined)
    : null;
  const progressWidth = Math.max(8, Math.min(32, Math.floor(dimensions.width / 4)));
  const filled = Math.round(verseId / surah.totalVerses * progressWidth);
  const arabicReadingHeight = gpuIllumination
    ? 7
    : Math.min(13, Math.max(7, arabic.split("\n").length + (playMode ? 5 : 6)));
  const activePaneLabel = showStudy ? "STUDY" : showHadith ? "RELATED HADITH" : playMode ? "FOLLOW PLAY" : "READ";
  const totalWords = verse.text.trim().split(/\s+/u).filter(Boolean).length;
  const footerMessageWidth = Math.max(16, dimensions.width - progressWidth - 18);
  const footerMessage = fitTerminalLabel(message, footerMessageWidth);
  const shortcuts = dimensions.width >= 100
    ? "j/k verse · / search · 1–4 mode · w study · W tafsir · h hadith · p play · v follow · ? help · q quit"
    : "j/k verse · / search · w study · h hadith · p play · q quit";

  return (
    <box width="100%" height="100%" flexDirection="column" zIndex={1}>
      <box height={3} zIndex={10} flexDirection="row" borderStyle="rounded" borderColor="#355663" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <text fg="#d8b45d">{`☾  ${surahId}. ${surah.transliteration} · ${surah.translation}`}</text>
        <text fg="#7797a5">{`${modeLabels[mode]} · ${layout.mode} · ${activePaneLabel}${gpuIllumination ? ` · 3D ${scriptStyle.toLocaleUpperCase()} ${readingLayout.toLocaleUpperCase()}` : terminalIllumination ? " · CELL ARCH" : ""}${safeMode ? " · SAFE" : ""}  ☽`}</text>
      </box>
      <box flexGrow={1} flexDirection="row">
        <box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center" paddingLeft={2} paddingRight={2}>
          <box width={readerWidth} minHeight={arabicReadingHeight} flexGrow={gpuIllumination ? 1 : undefined} zIndex={gpuIllumination ? 3 : undefined} marginTop={1} marginBottom={1} padding={1} borderStyle="double" borderColor={terminalIllumination || gpuIllumination ? "#8cd4cf" : focusGlow < 0.55 ? "#5b4c2d" : "#8b7441"} title={` ${verseKey} `} titleAlignment="center" alignItems="center" justifyContent="center">
            {terminalIllumination && <TerminalIllumination verseKey={verseKey} />}
            {gpuIllumination ? null : activeRenderedRange ? (
              <text fg={playMode ? "#6f7b76" : "#f2ead8"} attributes={TextAttributes.BOLD} wrapMode="none"><span>{arabic.slice(0, activeRenderedRange.start)}</span><span fg="#05070b" bg="#f1d77c">{arabic.slice(activeRenderedRange.start, activeRenderedRange.end)}</span><span>{arabic.slice(activeRenderedRange.end)}</span></text>
            ) : <text fg="#f2ead8" attributes={TextAttributes.BOLD} wrapMode="none">{arabic}</text>}
          </box>
          {presentation.showTranslation && (gpuIllumination ? (
            <box width={readerWidth} minHeight={3} zIndex={10} alignItems="center" justifyContent="center" paddingLeft={2} paddingRight={2}>
              <text fg="#d5ddda">{centerTerminalLines(verse.translation, Math.max(20, readerWidth - 4))}</text>
            </box>
          ) : (
            <box width={readerWidth} minHeight={3} alignItems="center" justifyContent="center" paddingLeft={2} paddingRight={2}>
              <text fg="#aebdba">{centerTerminalLines(verse.translation, Math.max(20, readerWidth - 4))}</text>
            </box>
          ))}
          {mode === "learn" && verse.transliteration && (
            <box width={readerWidth} minHeight={2} alignItems="center" justifyContent="center" paddingLeft={2} paddingRight={2}>
              <text fg="#60727a">{centerTerminalLines(verse.transliteration, Math.max(20, readerWidth - 4))}</text>
            </box>
          )}
          {playMode && !gpuIllumination && (
            <PlaybackStatus
              value={playbackVisual}
              verseKey={verseKey}
              activeWord={activeWordNumber}
              totalWords={totalWords}
              width={readerWidth}
              timed={hasTimings}
            />
          )}
        </box>
      </box>
      {showStudy && (
        <StudyPanel
          snapshot={study?.verseKey === verseKey ? study : null}
          source={studySource}
          verseKey={verseKey}
          verseText={verse.text}
          verseTranslation={verse.translation}
          width={Math.max(1, dimensions.width - 4)}
          height={Math.max(1, dimensions.height - 7)}
          overlay={true}
        />
      )}
      {showHadith && (
        <HadithPanel
          value={hadithPage?.verseKey === verseKey ? hadithPage : null}
          verseKey={verseKey}
          verseText={verse.text}
          verseTranslation={verse.translation}
          width={Math.max(1, dimensions.width - 4)}
          height={Math.max(1, dimensions.height - 7)}
          overlay={true}
          loadingMore={loadingMoreHadith}
          onLoadMore={loadMoreHadith}
        />
      )}
      {showImage && (
        <box
          position="absolute"
          top={3}
          left={2}
          zIndex={160}
          width={Math.max(1, dimensions.width - 4)}
          height={Math.max(1, dimensions.height - 8)}
          borderStyle="double"
          borderColor="#8b7441"
          backgroundColor="#081017"
          flexDirection="column"
          title={` Online ayah image · ${verseKey} · i closes `}
          titleAlignment="center"
        >
          <Suspense fallback={<text fg="#60727a">Loading the optional image renderer…</text>}>
            <LazyImageReader key={`${verseKey}-${imageRetry}`} surahId={surahId} verseId={verseId} focused={true} onError={handleImageError} />
          </Suspense>
        </box>
      )}
      <box height={4} zIndex={10} borderStyle="rounded" borderColor="#29404d" flexDirection="column" paddingLeft={1} paddingRight={1}>
        <box width="100%" flexDirection="row" justifyContent="space-between">
          <text fg="#d8b45d">{`${"━".repeat(filled)}${"─".repeat(progressWidth - filled)}  ${verseKey} · ${footerMessage}`}</text>
          <text fg="#60727a">{`${verseId}/${surah.totalVerses}`}</text>
        </box>
        <text fg="#60727a">{shortcuts}</text>
      </box>
      <ChoiceDialog
        visible={dialog !== null}
        title={dialog?.title ?? ""}
        description={dialog?.description ?? []}
        choices={dialog?.choices ?? []}
        onDismiss={() => dialog?.onDismiss ? dialog.onDismiss() : setDialog(null)}
      />
      {showSearch && (
        <Suspense fallback={<text zIndex={100} fg="#d8b45d">Loading Quran search…</text>}>
          <LazyFuzzySearchDialog
            visible={true}
            language="en"
            onSelect={(nextSurahId, nextVerseId) => {
              searchOpenRef.current = false;
              setShowSearch(false);
              setShowStudy(false);
              setShowHadith(false);
              setShowImage(false);
              activePaneRef.current = "reader";
              navigateTo(`${nextSurahId}:${nextVerseId}`);
              setMessage(`Search selected ${nextSurahId}:${nextVerseId}`);
            }}
            onDismiss={() => { searchOpenRef.current = false; setShowSearch(false); }}
          />
        </Suspense>
      )}
    </box>
  );
}

export default function ImmersiveApp(props: { safeMode?: boolean }) {
  return (
    <ModeProvider>
      <ThemeProvider>
        <ImmersiveAppContent {...props} />
      </ThemeProvider>
    </ModeProvider>
  );
}
