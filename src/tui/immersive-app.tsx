import { useKeyboard, useRenderer, useTerminalDimensions, useTimeline } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSurah } from "../data/quran.ts";
import { presentationFor, READING_MODES, type CapabilityState, type ReadingExperienceMode } from "../features/experience/mode.ts";
import { useFeatureCommand, useFeatureState } from "../features/react.tsx";
import type { RecitationPlayer } from "../features/audio/player.ts";
import type { TimedRecitationSession } from "../features/audio/timed-session.ts";
import type { StudyService, StudySnapshot } from "../features/study/service.ts";
import type { QuranReadingLayout, QuranReadingSurface, QuranScriptStyle, VisualBackdrop } from "../features/spatial/types.ts";
import { coherentVerseRows, exactLocalPageLines, pageFlowLines, resourceText, wordPosition } from "../features/spatial/reading-surface.ts";
import type { FollowCoordinator } from "../features/recognition/follow-coordinator.ts";
import type { TilawaRecognizer } from "../features/recognition/types.ts";
import { chooseReaderLayout, readerTransitionDuration } from "./responsive.ts";
import { alignRTL, RTL_STRATEGIES, renderArabicVerse, setRtlStrategy, wrapTerminalWords, type RtlStrategy } from "./utils/rtl.ts";
import { getPreference, setPreference } from "../data/preferences.ts";
import { parseWordKey, type WordKey } from "../domain/quran-coordinate.ts";
import { APP_DATA_DIR } from "../data/db.ts";
import { STARTER_RECITATION_PACK } from "../features/resources/public-recitation.ts";
import { ChoiceDialog, type DialogChoice } from "./components/choice-dialog.tsx";
import { TerminalIllumination } from "./components/terminal-illumination.tsx";
import { networkPlaybackIdentity } from "../features/audio/network-permission.ts";
import type { ResourceRow } from "../features/resources/repository.ts";
import type { HadithPage, HadithRecord } from "../features/hadith/types.ts";

const ONLINE_STUDY_PERMISSION_KEY = "onlineStudy.alquranCloudAccepted";
const ONLINE_IMAGE_PERMISSION_KEY = "onlineImage.islamicNetworkCdnAccepted.v1";
const ONLINE_HADITH_PERMISSION_KEY = "onlineHadith.quranFoundationAccepted.v1";
const ONLINE_PAGE_PERMISSION_KEY = "onlinePage.alquranCloudAccepted.v1";
const SPATIAL_TEXT_PERMISSION_KEY = "spatialText.quranComFontsAccepted.v1";
type StudySource = "local" | "online" | "hybrid";

const LazyImageReader = lazy(async () => {
  const module = await import("./components/image-reader.tsx");
  return { default: module.ImageReader };
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

function hasStudyContent(snapshot: StudySnapshot): boolean {
  return snapshot.translation.length > 0
    || snapshot.tafsir.length > 0
    || snapshot.words.length > 0
    || snapshot.topics.length > 0
    || snapshot.crossReferences.length > 0
    || snapshot.mushaf.length > 0;
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

function ResourceAttribution({ row }: { readonly row: ResourceRow }) {
  const provenance = row.provenance;
  if (!provenance) return <text fg="#52646b">Installed resource · attribution unavailable</text>;
  const termsUrl = typeof row.raw.termsUrl === "string" ? row.raw.termsUrl : undefined;
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
  width,
  height,
  overlay = false,
}: {
  readonly snapshot: StudySnapshot | null;
  readonly source: StudySource | null;
  readonly verseKey: string;
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
  const contentWidth = Math.max(1, width - 5);
  const displayText = (row: ResourceRow, value = row.text ?? ""): string => {
    if (!value) return "";
    const rtl = row.direction === "rtl" || row.language === "ar" || /[\u0600-\u06ff]/u.test(value);
    return rtl
      ? renderArabicVerse(value, 0, contentWidth).split("\n").map((line) => alignRTL(line, contentWidth)).join("\n")
      : wrapTerminalWords(value, contentWidth).join("\n");
  };
  const sourceLabel = source === "hybrid" ? "LOCAL + ONLINE" : source === "online" ? "ONLINE" : "LOCAL";
  const position = overlay
    ? { position: "absolute" as const, top: 3, left: 2, zIndex: 150, backgroundColor: "#081017" }
    : {};
  return (
    <box {...position} width={width} height={height} borderStyle="rounded" borderColor="#476672" flexDirection="column" padding={1}>
      <text fg="#d8b45d">{`Study · ${verseKey} · ${sourceLabel} · [/] scroll · w closes`}</text>
      <scrollbox ref={scrollRef} flexGrow={1} width="100%" scrollY={true} viewportCulling={true} scrollbarOptions={{ visible: true }}>
        {translationRow?.text ? (
          <box flexDirection="column">
            <text fg="#aeb8b6">{`Translation\n${displayText(translationRow)}`}</text>
            <ResourceAttribution row={translationRow} />
          </box>
        ) : <text fg="#60727a">No translation row available</text>}
        {tafsirRow?.text ? (
          <box flexDirection="column">
            <text fg="#8fa4aa">{`Tafsir\n${displayText(tafsirRow)}`}</text>
            <ResourceAttribution row={tafsirRow} />
          </box>
        ) : <text fg="#60727a">No tafsir row available</text>}
        {(snapshot?.topics.length ?? 0) > 0 ? snapshot!.topics.map((row, index) => (
          <box key={`${row.provenance?.packId ?? "topic"}-${index}`} flexDirection="column">
            <text fg="#6f8b91">{`Topic\n${displayText(row, row.topic ?? row.text ?? "Untitled")}`}</text>
            <ResourceAttribution row={row} />
          </box>
        )) : <text fg="#60727a">No topic row available</text>}
        {(snapshot?.words.length ?? 0) > 0 ? snapshot!.words.slice(0, 5).map((row, index) => (
          <box key={`${row.wordKey ?? "word"}-${row.provenance?.packId ?? index}`} flexDirection="column">
            <text fg="#7797a5">{displayText(row, row.text ?? "word")}</text>
            {row.root && <text fg="#6f8b91">{`Root\n${displayText(row, row.root)}`}</text>}
            <ResourceAttribution row={row} />
          </box>
        )) : <text fg="#60727a">No morphology row available</text>}
      </scrollbox>
    </box>
  );
}

function HadithPanel({
  value,
  verseKey,
  width,
  height,
  overlay = false,
  loadingMore,
  onLoadMore,
}: {
  readonly value: HadithPage | null;
  readonly verseKey: string;
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
  const contentWidth = Math.max(1, width - 5);
  const displayLines = (value: string, direction?: "rtl" | "ltr"): string[] => direction === "rtl" || /[\u0600-\u06ff]/u.test(value)
    ? renderArabicVerse(value, 0, contentWidth).split("\n").map((line) => alignRTL(line, contentWidth))
    : wrapTerminalWords(value, contentWidth);
  const sourceLabel = value?.source === "quran-foundation" ? "ONLINE · QURAN FOUNDATION" : "LOCAL PACK";
  const position = overlay
    ? { position: "absolute" as const, top: 3, left: 2, zIndex: 155, backgroundColor: "#081017" }
    : {};
  const renderRecord = (record: HadithRecord) => (
    <box key={record.id} flexDirection="column" marginBottom={1}>
      {displayLines(record.name).map((line, index) => <text key={`${record.id}-name-${index}`} fg="#d8b45d">{line}</text>)}
      <text fg="#d8b45d">Hadith</text>
      {displayLines(record.hadithNumber).map((line, index) => <text key={`${record.id}-number-${index}`} fg="#d8b45d">{line}</text>)}
      {record.texts.map((text, index) => (
        <box key={`${record.id}-${text.language}-${text.urn ?? index}`} flexDirection="column" marginTop={1}>
          {text.chapterTitle && displayLines(text.chapterTitle).map((line, lineIndex) => <text key={`${record.id}-${text.language}-chapter-${lineIndex}`} fg="#6f8b91">{line}</text>)}
          {displayLines(text.body, text.direction).map((line, lineIndex) => <text key={`${record.id}-${text.language}-body-${lineIndex}`} fg={text.language === "ar" ? "#f2ead8" : "#aeb8b6"}>{line}</text>)}
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
      <text fg="#52646b">Terms</text>
      {displayLines(record.provenance.license).map((line, index) => <text key={`${record.id}-license-${index}`} fg="#52646b">{line}</text>)}
      {record.provenance.sourceUrl && <text fg="#52646b" wrapMode="char">{`Source: ${record.provenance.sourceUrl}`}</text>}
      {record.provenance.termsUrl && <text fg="#52646b" wrapMode="char">{`Policy: ${record.provenance.termsUrl}`}</text>}
    </box>
  );
  return (
    <box {...position} width={width} height={height} borderStyle="rounded" borderColor="#476672" flexDirection="column" padding={1}>
      <text fg="#d8b45d">{`Hadith · ${verseKey} · ${sourceLabel} · [/] scroll · h closes`}</text>
      <scrollbox ref={scrollRef} flexGrow={1} width="100%" scrollY={true} viewportCulling={true} scrollbarOptions={{ visible: true }}>
        <text fg="#7797a5" wrapMode="char">Only narrations that explicitly reference this ayah are included. Quran.com curates this non-exhaustive selection from Sahih al-Bukhari and Sahih Muslim via Sunnah.com.</text>
        {(value?.records.length ?? 0) > 0
          ? value!.records.map(renderRecord)
          : <text fg="#60727a">No curated related hadith are currently available for this ayah.</text>}
        {value?.truncated && <text fg="#7797a5">Only twelve records remain visible at once to keep terminal memory bounded.</text>}
        {value?.hasMore && <text fg="#d8b45d">{loadingMore ? "Loading the next bounded page…" : "Press n to load the next 4 narrations"}</text>}
      </scrollbox>
    </box>
  );
}

export default function ImmersiveApp({ safeMode = false }: { safeMode?: boolean }) {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const layout = chooseReaderLayout(dimensions.width, dimensions.height);
  const [surahId, setSurahId] = useState(1);
  const [verseId, setVerseId] = useState(1);
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
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
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
  const backdropRef = useRef<(VisualBackdrop & { renderable: import("@opentui/core").Renderable }) | null>(null);
  const followRef = useRef<FollowCoordinator | null>(null);
  const timedRef = useRef<TimedRecitationSession | null>(null);
  const playbackSubscriptionRef = useRef<(() => void) | null>(null);
  const packDownloadRef = useRef<AbortController | null>(null);
  const openStudyRef = useRef<AbortController | null>(null);
  const clearOpenStudyCacheRef = useRef<(() => void) | null>(null);
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
  verseKeyRef.current = verseKey;

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

  const navigateTo = useCallback((key: `${number}:${number}`) => {
    const [nextSurah, nextVerse] = key.split(":").map(Number);
    if (nextSurah && nextVerse && getSurah(nextSurah)?.verses[nextVerse - 1]) {
      setSurahId(nextSurah);
      setVerseId(nextVerse);
    }
  }, []);

  const loadOnlineStudy = useCallback(async (key: string, localSnapshot?: StudySnapshot) => {
    const run = async (): Promise<void> => {
      openStudyRef.current?.abort(new Error("Replaced by a newer online study request"));
      const controller = new AbortController();
      openStudyRef.current = controller;
      setMessage(`Loading attributed online study for ${key}…`);
      try {
        const provider = await import("../features/study/open-provider.ts");
        clearOpenStudyCacheRef.current = provider.clearOpenStudyCache;
        const onlineSnapshot = await provider.fetchOpenStudySnapshot(key, { signal: controller.signal });
        controller.signal.throwIfAborted();
        if (verseKeyRef.current !== key || activePaneRef.current !== "study") return;
        const snapshot = localSnapshot && hasStudyContent(localSnapshot)
          ? { ...localSnapshot, tafsir: localSnapshot.tafsir.length > 0 ? localSnapshot.tafsir : onlineSnapshot.tafsir }
          : onlineSnapshot;
        setStudy(snapshot);
        setStudySource(localSnapshot && hasStudyContent(localSnapshot) ? "hybrid" : "online");
        setShowImage(false);
        setShowStudy(true);
        setMessage(`${provider.OPEN_STUDY_PROVIDER.editionName} · online fallback from ${provider.OPEN_STUDY_PROVIDER.name}`);
      } catch (cause) {
        if (controller.signal.aborted || verseKeyRef.current !== key || activePaneRef.current !== "study") return;
        const detail = deepestErrorMessage(cause, "Online study is unavailable");
        setMessage(`${detail} · the Quran reader remains available offline`);
        setDialog({
          title: "Online study unavailable",
          description: [detail, "Your Quran text and translation remain available offline."],
          choices: [
            {
              key: "r",
              label: "Retry online study",
              action: () => {
                setDialog(null);
                if (verseKeyRef.current === key) void run();
                else setMessage("The ayah changed · press w to load study for the current ayah");
              },
            },
            {
              key: "c",
              label: localSnapshot && hasStudyContent(localSnapshot) ? "Show local QUL rows" : "Continue offline",
              action: () => {
                setDialog(null);
                if (verseKeyRef.current !== key) {
                  setMessage("The ayah changed · press w to load local study for the current ayah");
                  return;
                }
                if (localSnapshot && hasStudyContent(localSnapshot)) {
                  setStudy(localSnapshot);
                  setStudySource("local");
                  setShowStudy(true);
                  setMessage("Showing attributed local QUL-compatible rows; online tafsir remains unavailable");
                } else {
                  setShowStudy(false);
                  setStudySource(null);
                }
              },
            },
          ],
        });
      } finally {
        if (openStudyRef.current === controller) openStudyRef.current = null;
      }
    };
    await run();
  }, []);

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
    try {
      const service = studyRef.current ?? await studyFeature.activate();
      if (verseKeyRef.current !== requestedKey || activePaneRef.current !== "study") return;
      studyRef.current = service;
      const snapshot = await service.inspect(requestedKey);
      if (verseKeyRef.current !== requestedKey || activePaneRef.current !== "study") return;
      if (snapshot.tafsir.length > 0) {
        setStudy(snapshot);
        setStudySource("local");
        setShowImage(false);
        setShowStudy(true);
        setMessage(`Loaded ${service.licenses().length} attributed local resource pack(s)`);
        return;
      }
      if (getPreference(ONLINE_STUDY_PERMISSION_KEY) === "true") {
        await loadOnlineStudy(requestedKey, hasStudyContent(snapshot) ? snapshot : undefined);
        return;
      }
      const hasLocalRows = hasStudyContent(snapshot);
      setDialog({
        title: "Use open online study data?",
        description: [
          hasLocalRows
            ? "Installed QUL-compatible rows will stay local, but no local tafsir is available for this ayah."
            : "No compatible QUL study row is installed for this ayah.",
          "Fallback: Tafsir al-Muyassar from the keyless Al Quran Cloud / Islamic Network API.",
          "Only the verse key is requested. The provider receives your IP address; quran.sh sends no account, notes, history, or telemetry.",
          "The response is size-limited, kept in a 24-ayah memory cache, and cleared when the reader closes.",
        ],
        choices: [{
          key: "y",
          label: "Use online fallback",
          detail: "Remember this provider choice on this device.",
          action: () => {
            setDialog(null);
            if (verseKeyRef.current !== requestedKey) {
              setMessage("The ayah changed · press w to choose study data for the current ayah");
              return;
            }
            setPreference(ONLINE_STUDY_PERMISSION_KEY, "true");
            void loadOnlineStudy(requestedKey, hasLocalRows ? snapshot : undefined);
          },
        }, {
          key: "l",
          label: "Stay local",
          detail: "Continue reading; QUL packs can still be imported later.",
          action: () => {
            setDialog(null);
            if (verseKeyRef.current !== requestedKey) {
              setMessage("The ayah changed · press w to load local study for the current ayah");
              return;
            }
            if (hasLocalRows) {
              setStudy(snapshot);
              setStudySource("local");
              setShowImage(false);
              setShowStudy(true);
              setMessage("Showing the available local QUL-compatible rows; no local tafsir is installed");
            } else {
              setMessage("Staying local · use `quran resources import` whenever you have a compatible QUL pack");
            }
          },
        }],
      });
    } catch (cause) {
      if (verseKeyRef.current === requestedKey && activePaneRef.current === "study") setMessage(cause instanceof Error ? cause.message : "Study pack unavailable");
    }
  }, [loadOnlineStudy, safeMode, showStudy, studyFeature, verseKey]);

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
    let localFailure: string | null = null;
    try {
      const [service, local] = await Promise.all([
        studyRef.current ? Promise.resolve(studyRef.current) : studyFeature.activate(),
        import("../features/hadith/local.ts"),
      ]);
      if (verseKeyRef.current !== requestedKey || activePaneRef.current !== "hadith") return;
      studyRef.current = service;
      const localRows = await service.hadith?.(requestedKey) ?? [];
      if (verseKeyRef.current !== requestedKey || activePaneRef.current !== "hadith") return;
      const localPage = local.hadithPageFromLocalRows(requestedKey, localRows);
      if (localPage.records.length > 0) {
        setHadithPage(localPage);
        setShowStudy(false);
        setShowImage(false);
        setShowHadith(true);
        setMessage(`Loaded ${localPage.records.length} related narration(s) from attributed local packs`);
        return;
      }
    } catch (cause) {
      localFailure = deepestErrorMessage(cause, "The local related-hadith source is unavailable");
    }
    if (verseKeyRef.current !== requestedKey || activePaneRef.current !== "hadith") return;
    let provider: typeof import("../features/hadith/quran-foundation-provider.ts") | null = null;
    try { provider = await import("../features/hadith/quran-foundation-provider.ts"); }
    catch (cause) { localFailure = [localFailure, deepestErrorMessage(cause, "The in-reader provider could not load")].filter(Boolean).join(" · "); }
    if (verseKeyRef.current !== requestedKey || activePaneRef.current !== "hadith") return;
    if (provider?.hasQuranFoundationCredentials()) {
      if (getPreference(ONLINE_HADITH_PERMISSION_KEY) === "true") {
        await loadOnlineHadith(requestedKey);
        return;
      }
      setDialog({
        title: "Use Quran Foundation related hadith?",
        description: [
          ...(localFailure ? [`Local source: ${localFailure}`] : []),
          "QUL currently has no hadith dataset. The official Quran Foundation API supplies Quran.com's curated, non-exhaustive links to Sahih al-Bukhari and Sahih Muslim via Sunnah.com.",
          `Only ayah ${requestedKey} is requested. Quran Foundation receives your IP address; quran.sh sends no notes, history, bookmarks, or surrounding ayat.`,
          "Your QF_CLIENT_SECRET is sent only to Quran Foundation's OAuth host, held in memory with its short-lived token, and never logged or persisted by quran.sh.",
          "Four narrations in both Arabic and English are requested at a time; responses are size-limited and retained only in a 24-page/2 MiB session cache.",
        ],
        choices: [{
          key: "y",
          label: "Use official API",
          detail: "Remember this provider choice on this device.",
          action: () => {
            setDialog(null);
            if (verseKeyRef.current !== requestedKey) { setMessage("The ayah changed · press h for its related hadith"); return; }
            setPreference(ONLINE_HADITH_PERMISSION_KEY, "true");
            void loadOnlineHadith(requestedKey);
          },
        }, {
          key: "o",
          label: "Open Quran.com",
          detail: "View the same curated feature in your browser without giving quran.sh API credentials.",
          action: () => { setDialog(null); void openQuranComHadithPage(requestedKey); },
        }, {
          key: "l",
          label: "Stay local",
          action: () => { activePaneRef.current = "reader"; setDialog(null); setMessage("No local related-hadith pack covers this ayah; reading remains offline"); },
        }],
      });
      return;
    }
    setDialog({
      title: "View related hadith for this ayah?",
      description: [
        ...(localFailure ? [`Local source: ${localFailure}`] : []),
        "QUL currently has no hadith dataset, and Quran Foundation's supported API requires approved developer credentials that quran.sh does not bundle.",
        "Quran.com's list contains narrations that explicitly cite this ayah, is limited to Sahih al-Bukhari and Sahih Muslim, and is not exhaustive. Some ayat have no entries.",
        "Open the canonical Quran.com page now, or later configure QF_CLIENT_ID and QF_CLIENT_SECRET for the lazy in-reader panel.",
      ],
      choices: [{
        key: "o",
        label: "Open Quran.com",
        detail: `Open ${quranComHadithUrl(requestedKey)} in the system browser.`,
        action: () => { setDialog(null); void openQuranComHadithPage(requestedKey); },
      }, {
        key: "l",
        label: "Stay local",
        action: () => { activePaneRef.current = "reader"; setDialog(null); setMessage("Stayed offline; press h whenever you want related hadith"); },
      }],
    });
  }, [loadOnlineHadith, openQuranComHadithPage, safeMode, showHadith, studyFeature, verseKey]);

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

  const preloadFollowingAyah = useCallback(async (currentKey: string, player: RecitationPlayer, approvedPreferenceKey: string) => {
    const [currentSurah, currentVerse] = currentKey.split(":").map(Number);
    if (!currentSurah || !currentVerse) return;
    const nextKey = adjacentVerseKey(currentSurah, currentVerse, 1);
    const request = ++preloadRequestRef.current;
    if (!nextKey) {
      player.clearPreload?.();
      return;
    }
    try {
      const service = studyRef.current ?? await studyFeature.activate();
      if (request !== preloadRequestRef.current || !playModeRef.current) return;
      studyRef.current = service;
      const rows = await service.recitation(nextKey);
      const row = rows.find((candidate) => candidate.audioUrl);
      const url = row?.audioUrl;
      if (!url || request !== preloadRequestRef.current || !playModeRef.current) return;
      const network = networkPlaybackIdentity(url, row);
      if (network.preferenceKey !== approvedPreferenceKey || getPreference(network.preferenceKey) !== "true") return;
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
    let network;
    try { network = networkPlaybackIdentity(url, rows.find((row) => row.audioUrl === url)); }
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
      setHasTimings(timingsValid);
      const timed = createTimedRecitationSession(player, (key) => key === requestedKey ? timings : null);
      timed.subscribe((state) => setActiveWordKey(state.wordKey));
      timedRef.current = timed;
      playbackSubscriptionRef.current?.();
      playbackSubscriptionRef.current = player.subscribe((state) => {
        if (state.status !== "error" || state.verseKey !== requestedKey || verseKeyRef.current !== requestedKey) return;
        playbackSubscriptionRef.current?.();
        playbackSubscriptionRef.current = null;
        preloadRequestRef.current++;
        setPlaybackFollowing(false);
        player.clearPreload?.();
        timedRef.current?.dispose();
        timedRef.current = null;
        setActiveWordKey(null);
        setHasTimings(false);
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
      if (!isCurrentRequest()) {
        timed.dispose();
        if (timedRef.current === timed) timedRef.current = null;
        return;
      }
      setPlaybackFollowing(true);
      await player.play(requestedKey, url);
      if (!isCurrentRequest() || !playModeRef.current) return;
      setMessage(timingsValid ? `Following ${requestedKey} with verified word timing · next ayah preloading` : `Following ${requestedKey} at ayah level · next ayah preloading`);
      void preloadFollowingAyah(requestedKey, player, network.preferenceKey);
    };
    if (playbackRequestRef.current !== playbackRequest || verseKeyRef.current !== requestedKey) return;
    if (getPreference(network.preferenceKey) !== "true") {
      setDialog({
        title: "Allow network playback?",
        description: [
          `Provider: ${network.provider}`,
          `Audio host: ${network.hostname} (${network.origin})`,
          "quran.sh sends no listening history or telemetry; this provider receives the normal media request.",
        ],
        choices: [{
          key: "y",
          label: "Allow and play",
          detail: "Remember this choice on this device.",
          action: () => {
            setDialog(null);
            setPreference(network.preferenceKey, "true");
            void begin().catch((cause) => setMessage(cause instanceof Error ? cause.message : "Playback unavailable"));
          },
        }],
      });
      return;
    }
    await begin();
  }, [playerFeature, preloadFollowingAyah, setPlaybackFollowing]);

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
      await startPlayback(requestedKey, rows, url, playbackRequest);
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
  }, [startPlayback, studyFeature, verseKey]);

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
            "Playback is ayah-level; verified word timing can be added later from a compatible QUL pack.",
          ],
          choices: [{ key: "d", label: "Download pack", detail: "License and attribution are stored with the installed pack.", action: () => void installStarterPackAndPlay() }],
        });
        return;
      }
      await startPlayback(requestedKey, rows, url, playbackRequest);
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
  }, [installStarterPackAndPlay, safeMode, setPlaybackFollowing, startPlayback, studyFeature]);

  const play = useCallback(() => playVerse(verseKey, true), [playVerse, verseKey]);

  const stopPlayback = useCallback(() => {
    playbackRequestRef.current++;
    preloadRequestRef.current++;
    setPlaybackFollowing(false);
    playerRef.current?.stop();
    playerRef.current?.clearPreload?.();
    playbackSubscriptionRef.current?.();
    playbackSubscriptionRef.current = null;
    timedRef.current?.dispose();
    timedRef.current = null;
    setActiveWordKey(null);
    setHasTimings(false);
    setMessage("Playback stopped; reading position preserved");
  }, [setPlaybackFollowing]);

  useEffect(() => {
    if (!playModeRef.current) return;
    preloadRequestRef.current++;
    playerRef.current?.stop();
    timedRef.current?.dispose();
    timedRef.current = null;
    setActiveWordKey(null);
    setMessage(`Moving playback to ${verseKey}…`);
    void playVerse(verseKey, false);
  }, [playVerse, verseKey]);

  const resolveLocalMushafRow = useCallback(async (): Promise<ResourceRow | null> => {
    const current = study?.verseKey === verseKey
      ? study.mushaf.find((row) => row.page && row.line) ?? null
      : null;
    if (current) return current;
    try {
      const service = studyRef.current ?? await studyFeature.activate();
      studyRef.current = service;
      const snapshot = await service.inspect(verseKey);
      return snapshot.mushaf.find((candidate) => candidate.page && candidate.line) ?? null;
    } catch {
      return null;
    }
  }, [study, studyFeature, verseKey]);

  const buildReadingSurface = useCallback(async (
    requestedKey: `${number}:${number}`,
    targetLayout: QuranReadingLayout,
    targetScript: QuranScriptStyle,
    allowOnlinePage: boolean,
  ): Promise<QuranReadingSurface> => {
    const [requestedSurah, requestedAyah] = requestedKey.split(":").map(Number);
    const builtin = getSurah(requestedSurah!)?.verses[requestedAyah! - 1];
    if (!builtin) throw new Error(`Invalid Quran coordinate: ${requestedKey}`);
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
    if (getPreference(ONLINE_IMAGE_PERMISSION_KEY) === "true") {
      openImage();
      return;
    }
    setDialog({
      title: "Use an online ayah image?",
      description: [
        "QUL-compatible packs remain the preferred source for structured Mushaf layout. This optional visual fallback requests the active ayah PNG from the documented Al Quran Cloud / Islamic Network CDN.",
        "The CDN receives your IP address. quran.sh sends no account, notes, history, or telemetry.",
        "High resolution is tried first, then normal resolution on the same HTTPS origin. The PNG is signature-checked, size-limited, cached only in memory, and unloaded when the view closes.",
      ],
      choices: [{
        key: "y",
        label: "Use online image",
        detail: "Remember this provider choice on this device.",
        action: () => { setPreference(ONLINE_IMAGE_PERMISSION_KEY, "true"); setDialog(null); openImage(); },
      }, {
        key: "t",
        label: "Keep terminal text",
        detail: "Continue at the same ayah without a network request.",
        action: () => { setDialog(null); setMessage("Using the built-in Quran text; press i whenever you want the image view"); },
      }],
    });
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

  const enableSpatial = useCallback(async (localMushafRow: ResourceRow | null) => {
    let activated: (VisualBackdrop & { renderable: import("@opentui/core").Renderable }) | null = null;
    let attached = false;
    try {
      const backdrop = await spatialFeature.activate();
      activated = backdrop;
      renderer.root.add(backdrop.renderable, 0);
      attached = true;
      backdrop.setReducedMotion(reducedMotion);
      backdrop.setVerse(verseKey, verseId / surah.totalVerses);
      backdrop.setMushafContext(localMushafRow ? { page: localMushafRow.page!, activeLine: localMushafRow.line!, totalLines: Number(localMushafRow.raw.total_lines ?? 15) } : null);
      backdropRef.current = backdrop;
      setTerminalIllumination(false);
      setGpuIllumination(true);
      await applyReadingSurface(verseKey, readingLayout, scriptStyle, getPreference(ONLINE_PAGE_PERMISSION_KEY) === "true");
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
      const { diagnoseWebGpuFailure } = await import("../features/spatial/diagnostics.ts");
      const diagnosis = diagnoseWebGpuFailure(reason);
      setDialog({
        title: "3D backdrop unavailable",
        description: [`${diagnosis.summary}${cleanup}`, ...diagnosis.steps],
        choices: [
          {
            key: "f",
            label: "Use terminal illumination",
            detail: "A lightweight terminal-cell design with no GPU or native dependency.",
            action: () => { setDialog(null); setGpuIllumination(false); setTerminalIllumination(true); setMessage("Terminal arch illumination on · it follows the active ayah · g turns it off"); },
          },
          { key: "r", label: "Retry WebGPU", detail: "Useful after changing drivers or the terminal session.", action: () => { setDialog(null); void enableSpatial(localMushafRow); } },
          { key: "i", label: "Use online ayah image", detail: "A consented Braille image view that needs no WebGPU device.", action: () => { setDialog(null); requestImage(); } },
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
    const localMushafRow = await resolveLocalMushafRow();
    if (verseKeyRef.current !== verseKey) {
      setMessage("The ayah changed while checking local Mushaf data · press g again for the current ayah");
      return;
    }
    if (getPreference(SPATIAL_TEXT_PERMISSION_KEY) !== "true") {
      setDialog({
        title: "Enable the 3D Arabic reader?",
        description: [
          "This starts a local WebGPU device and renders the Quran as shaped RTL vector outlines inside OpenTUI Three; the text is not a rasterized terminal screenshot.",
          "The selected Quran WOFF2 font is fetched from quran.com, bounded to 512 KiB, kept only in a two-font memory cache, and discarded when quran.sh exits. quran.com receives your IP address; no reading history, notes, or telemetry are sent.",
          "Uthmani and IndoPak use their real font faces. Tajweed is enabled only with verified QCF code_v2 data so its embedded rule colors remain authoritative.",
          localMushafRow
            ? `The installed QUL-compatible layout can reproduce page ${localMushafRow.page}, line ${localMushafRow.line}.`
            : "Ayah mode works from the built-in Quran text. Page mode can later ask permission for the open Al Quran Cloud source; exact Mushaf lines remain local-pack only.",
        ],
        choices: [{
          key: "y",
          label: "Enable 3D Arabic reader",
          action: () => { setDialog(null); setPreference(SPATIAL_TEXT_PERMISSION_KEY, "true"); void enableSpatial(localMushafRow); },
        }, {
          key: "f",
          label: "Keep terminal reader",
          detail: "No GPU or font network request is needed.",
          action: () => { setDialog(null); setMessage("Using the terminal Quran reader; press g whenever you want the 3D reader"); },
        }],
      });
      return;
    }
    await enableSpatial(localMushafRow);
  }, [enableSpatial, gpuIllumination, renderer, requestImage, resolveLocalMushafRow, safeMode, spatialFeature, terminalIllumination]);

  const toggleReadingLayout = useCallback(async () => {
    if (!backdropRef.current) {
      setMessage("Page and ayah surfaces are part of the 3D reader · press g to enable it first");
      return;
    }
    const nextLayout: QuranReadingLayout = readingLayout === "ayah" ? "page" : "ayah";
    const load = async (allowOnline: boolean) => {
      try { await applyReadingSurface(verseKey, nextLayout, scriptStyle, allowOnline); }
      catch (cause) {
        const detail = deepestErrorMessage(cause, "The requested Quran surface is unavailable");
        if (detail === "ONLINE_PAGE_PERMISSION_REQUIRED") {
          setDialog({
            title: "Load this Quran page?",
            description: [
              "No compatible local QUL Mushaf layout covers this ayah. The open Al Quran Cloud API can supply the canonical Uthmani ayat belonging to this page.",
              `Only ayah ${verseKey} is requested to resolve its page, followed by that page's Quran text. Islamic Network receives your IP address; quran.sh sends no history, notes, or telemetry.`,
              "The fallback flows the canonical ayat into the available terminal geometry; it does not claim the exact printed 15-line Mushaf layout. A local QUL mushaf-layout pack upgrades it automatically.",
            ],
            choices: [{
              key: "y",
              label: "Load canonical page",
              detail: "Remember this provider choice on this device.",
              action: () => { setPreference(ONLINE_PAGE_PERMISSION_KEY, "true"); setDialog(null); void load(true); },
            }, {
              key: "a",
              label: "Stay in ayah mode",
              action: () => { setDialog(null); setMessage("Stayed in the vector ayah reader; no page request was sent"); },
            }],
          });
          return;
        }
        setDialog({
          title: `${scriptStyle === "tajweed" ? "Tajweed" : "IndoPak"} page source unavailable`,
          description: [detail, "quran.sh will not relabel Uthmani text or invent Tajweed colors. Import compatible quran-script and mushaf-layout packs with `quran resources import`, or continue immediately in Uthmani ayah mode."],
          choices: [{
            key: "u",
            label: "Use Uthmani ayah",
            action: () => { setDialog(null); void applyReadingSurface(verseKey, "ayah", "uthmani", false); },
          }, {
            key: "c",
            label: "Keep current surface",
            action: () => setDialog(null),
          }],
        });
      }
    };
    await load(getPreference(ONLINE_PAGE_PERMISSION_KEY) === "true");
  }, [applyReadingSurface, readingLayout, scriptStyle, verseKey]);

  const cycleScriptStyle = useCallback(async () => {
    if (!backdropRef.current) {
      setMessage("Quran script faces are part of the 3D reader · press g to enable it first");
      return;
    }
    const nextScript: QuranScriptStyle = scriptStyle === "uthmani" ? "indopak" : scriptStyle === "indopak" ? "tajweed" : "uthmani";
    try {
      await applyReadingSurface(verseKey, readingLayout, nextScript, getPreference(ONLINE_PAGE_PERMISSION_KEY) === "true");
    } catch (cause) {
      const detail = deepestErrorMessage(cause, `${nextScript} rendering is unavailable`);
      setDialog({
        title: `${nextScript === "tajweed" ? "Tajweed" : "IndoPak"} data is not installed`,
        description: [
          detail,
          nextScript === "tajweed"
            ? "Tajweed colors come from Quran.com's verified per-page QCF glyph palette. quran.sh needs matching local code_v2 words and page numbers, and will never guess colors from Unicode characters."
            : "The IndoPak face can render the current ayah, but exact IndoPak page text and line placement need compatible local quran-script and mushaf-layout packs.",
          "Import user-obtained QUL-compatible packs with `quran resources import manifest.json data.json`; the current Quran reader remains available now.",
        ],
        choices: [{
          key: "u",
          label: "Use Uthmani ayah",
          action: () => { setDialog(null); void applyReadingSurface(verseKey, "ayah", "uthmani", false); },
        }, {
          key: "c",
          label: "Keep current surface",
          action: () => setDialog(null),
        }],
      });
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
    if (studySource === "online") {
      void loadOnlineStudy(verseKey);
      return;
    }
    let active = true;
    if (studyRef.current && (studySource === "local" || studySource === "hybrid")) {
      void studyRef.current.inspect(verseKey).then((snapshot) => {
        if (!active) return;
        if (studySource === "hybrid" && snapshot.tafsir.length === 0) {
          void loadOnlineStudy(verseKey, hasStudyContent(snapshot) ? snapshot : undefined);
          return;
        }
        setStudy(snapshot);
        setStudySource("local");
      });
    }
    return () => { active = false; };
  }, [loadOnlineStudy, showStudy, study?.verseKey, studySource, surah.totalVerses, verseId, verseKey]);

  useEffect(() => {
    if (!backdropRef.current) return;
    const allowOnline = getPreference(ONLINE_PAGE_PERMISSION_KEY) === "true";
    void applyReadingSurface(verseKey, readingLayout, scriptStyle, allowOnline).catch((cause) => {
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
    if (!backdropRef.current) return;
    let active = true;
    void resolveLocalMushafRow().then((row) => {
      if (!active || !backdropRef.current) return;
      backdropRef.current.setMushafContext(row ? {
        page: row.page!,
        activeLine: row.line!,
        totalLines: Number(row.raw.total_lines ?? 15),
      } : null);
    });
    return () => { active = false; };
  }, [resolveLocalMushafRow, verseKey]);

  useEffect(() => () => {
    packDownloadRef.current?.abort(new Error("Reader closed"));
    openStudyRef.current?.abort(new Error("Reader closed"));
    hadithRequestRef.current?.abort(new Error("Reader closed"));
    pageRequestRef.current?.abort(new Error("Reader closed"));
    clearOpenStudyCacheRef.current?.();
    clearHadithCacheRef.current?.();
    clearPageCacheRef.current?.();
    playerRef.current?.stop();
    playerRef.current?.clearPreload?.();
    playbackSubscriptionRef.current?.();
    playbackSubscriptionRef.current = null;
    timedRef.current?.dispose();
    void followRef.current?.stop();
    if (backdropRef.current?.renderable.parent) backdropRef.current.renderable.parent.remove(backdropRef.current.renderable);
  }, [renderer]);

  useKeyboard((key) => {
    if (dialog) return;
    if (key.sequence === "q") { renderer.destroy(); return; }
    if (key.sequence && ["1", "2", "3", "4"].includes(key.sequence)) { setMode(READING_MODES[Number(key.sequence) - 1]!); return; }
    if (key.sequence === "w") { setShowHadith(false); void inspect(); return; }
    if (key.sequence === "h") { setShowStudy(false); void inspectHadith(); return; }
    if (key.sequence === "i") { toggleImage(); return; }
    if (key.sequence === "p") { if (playModeRef.current) stopPlayback(); else void play(); return; }
    if (key.sequence === "g") { void toggleSpatial(); return; }
    if (key.sequence === "r") { void toggleReadingLayout(); return; }
    if (key.sequence === "f") { void cycleScriptStyle(); return; }
    if (key.sequence === "v") { void toggleFollow(); return; }
    if (key.sequence === "M") {
      const next = !reducedMotion;
      setReducedMotion(next);
      setPreference("reducedMotion", String(next));
      backdropRef.current?.setReducedMotion(next);
      setMessage(next ? "Reduced motion on" : "Reduced motion off");
      return;
    }
    if (key.name === "down" || key.sequence === "j") {
      if (verseId < surah.totalVerses) setVerseId((value) => value + 1);
      else if (surahId < 114) { setSurahId((value) => value + 1); setVerseId(1); }
    }
    if (key.name === "up" || key.sequence === "k") {
      if (verseId > 1) setVerseId((value) => value - 1);
      else if (surahId > 1) { const previous = getSurah(surahId - 1)!; setSurahId((value) => value - 1); setVerseId(previous.totalVerses); }
    }
  });

  const showSidePanel = (showStudy || showHadith) && layout.showAuxiliaryPanel;
  const lineWidth = Math.max(28, Math.min(96, dimensions.width - (showSidePanel ? 42 : 8)));
  const arabic = useMemo(() => renderArabicVerse(verse.text, 0, lineWidth), [lineWidth, verse.text]);
  const activeWordNumber = activeWordKey && parseWordKey(activeWordKey)?.key.startsWith(`${verseKey}:`) ? parseWordKey(activeWordKey)?.word : null;
  const activeRenderedWord = activeWordNumber ? renderArabicVerse(verse.text.split(/\s+/)[activeWordNumber - 1] ?? "", 0, lineWidth) : "";
  const activeRenderedIndex = activeRenderedWord ? arabic.indexOf(activeRenderedWord) : -1;
  const previous = verseId > 1 ? surah.verses[verseId - 2] : null;
  const next = verseId < surah.totalVerses ? surah.verses[verseId] : null;
  const progressWidth = Math.max(8, Math.min(32, Math.floor(dimensions.width / 4)));
  const filled = Math.round(verseId / surah.totalVerses * progressWidth);

  return (
    <box width="100%" height="100%" flexDirection="column" zIndex={1}>
      <box height={3} flexDirection="row" borderStyle="rounded" borderColor="#355663" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <text fg="#d8b45d">{`☾  ${surahId}. ${surah.transliteration} · ${surah.translation}`}</text>
        <text fg="#7797a5">{`${modeLabels[mode]} · ${layout.mode}${playMode ? " · FOLLOW PLAY" : ""}${gpuIllumination ? ` · 3D ${scriptStyle.toLocaleUpperCase()} ${readingLayout.toLocaleUpperCase()}` : terminalIllumination ? " · CELL ARCH" : ""}${safeMode ? " · SAFE" : ""}  ☽`}</text>
      </box>
      <box flexGrow={1} flexDirection="row">
        <box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center" paddingLeft={2} paddingRight={2}>
          {!gpuIllumination && layout.mode !== "compact" && previous && <text fg="#354249">{renderArabicVerse(previous.text, 0, lineWidth)}</text>}
          <box width="100%" minHeight={7} marginTop={1} marginBottom={1} padding={1} borderStyle="double" borderColor={terminalIllumination || gpuIllumination ? "#69a6a4" : focusGlow < 0.55 ? "#5b4c2d" : "#8b7441"} alignItems="center" justifyContent="center">
            {terminalIllumination && <TerminalIllumination verseKey={verseKey} />}
            {gpuIllumination ? <text> </text> : activeRenderedIndex >= 0 ? (
              <text fg="#f2ead8"><span>{arabic.slice(0, activeRenderedIndex)}</span><span fg="#05070b" bg="#d8b45d">{activeRenderedWord}</span><span>{arabic.slice(activeRenderedIndex + activeRenderedWord.length)}</span></text>
            ) : <text fg="#f2ead8">{arabic}</text>}
          </box>
          {presentation.showTranslation && <text fg="#aeb8b6">{verse.translation}</text>}
          {!gpuIllumination && !presentation.hideNextVerse && layout.mode === "immersive" && next && <text fg="#354249">{renderArabicVerse(next.text, 0, lineWidth)}</text>}
        </box>
        {showStudy && layout.showAuxiliaryPanel && (
          <StudyPanel snapshot={study} source={studySource} verseKey={verseKey} width={40} />
        )}
        {showHadith && hadithPage?.verseKey === verseKey && layout.showAuxiliaryPanel && (
          <HadithPanel value={hadithPage} verseKey={verseKey} width={40} loadingMore={loadingMoreHadith} onLoadMore={loadMoreHadith} />
        )}
      </box>
      {showStudy && !layout.showAuxiliaryPanel && (
        <StudyPanel
          snapshot={study}
          source={studySource}
          verseKey={verseKey}
          width={Math.max(1, dimensions.width - 4)}
          height={Math.max(1, dimensions.height - 8)}
          overlay={true}
        />
      )}
      {showHadith && hadithPage?.verseKey === verseKey && !layout.showAuxiliaryPanel && (
        <HadithPanel
          value={hadithPage}
          verseKey={verseKey}
          width={Math.max(1, dimensions.width - 4)}
          height={Math.max(1, dimensions.height - 8)}
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
      <box height={5} borderStyle="rounded" borderColor="#29404d" flexDirection="column" paddingLeft={1} paddingRight={1}>
        <box flexDirection="row" justifyContent="space-between"><text fg="#d8b45d">{`${"━".repeat(filled)}${"─".repeat(progressWidth - filled)}  ${verseKey}`}</text><text fg="#60727a">{`${verseId}/${surah.totalVerses}`}</text></box>
        <text fg="#8fa4aa">{message}</text>
        <text fg="#60727a">{`j/k verse · 1-4 mode · w study · h hadith · i image · p play · v follow · g spatial · r ayah/page · f script · M motion · q quit`}</text>
      </box>
      <ChoiceDialog
        visible={dialog !== null}
        title={dialog?.title ?? ""}
        description={dialog?.description ?? []}
        choices={dialog?.choices ?? []}
        onDismiss={() => dialog?.onDismiss ? dialog.onDismiss() : setDialog(null)}
      />
    </box>
  );
}
