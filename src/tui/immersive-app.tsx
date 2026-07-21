import { useKeyboard, useRenderer, useTerminalDimensions, useTimeline } from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSurah } from "../data/quran.ts";
import { presentationFor, READING_MODES, type CapabilityState, type ReadingExperienceMode } from "../features/experience/mode.ts";
import { useFeatureCommand, useFeatureState } from "../features/react.tsx";
import type { RecitationPlayer } from "../features/audio/player.ts";
import type { TimedRecitationSession } from "../features/audio/timed-session.ts";
import type { StudyService, StudySnapshot } from "../features/study/service.ts";
import type { VisualBackdrop } from "../features/spatial/types.ts";
import type { FollowCoordinator } from "../features/recognition/follow-coordinator.ts";
import type { TilawaRecognizer } from "../features/recognition/types.ts";
import { chooseReaderLayout, readerTransitionDuration } from "./responsive.ts";
import { RTL_STRATEGIES, renderArabicVerse, setRtlStrategy, type RtlStrategy } from "./utils/rtl.ts";
import { getPreference, setPreference } from "../data/preferences.ts";
import { parseWordKey, type WordKey } from "../domain/quran-coordinate.ts";

const modeLabels: Record<ReadingExperienceMode, string> = {
  focus: "Focus", learn: "Learn", recite: "Recite", memorise: "Memorise",
};

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
  const [showStudy, setShowStudy] = useState(false);
  const [activeWordKey, setActiveWordKey] = useState<WordKey | null>(null);
  const [hasTimings, setHasTimings] = useState(false);
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
  const backdropRef = useRef<(VisualBackdrop & { renderable: import("@opentui/core").Renderable }) | null>(null);
  const followRef = useRef<FollowCoordinator | null>(null);
  const timedRef = useRef<TimedRecitationSession | null>(null);
  const followDisclosurePending = useRef(false);
  const playbackDisclosurePending = useRef(false);
  const spatialDisclosurePending = useRef(false);
  const surah = getSurah(surahId)!;
  const verse = surah.verses[verseId - 1]!;
  const verseKey = `${surahId}:${verseId}` as const;

  const capabilities: CapabilityState = {
    text: true,
    study: studyState.status === "ready",
    images: true,
    playback: audioState.status === "ready",
    timings: hasTimings,
    recognition: recognitionState.status === "ready",
    microphone: Boolean(Bun.which("ffmpeg")),
    spatial: spatialState.status === "ready",
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

  const inspect = useCallback(async () => {
    if (safeMode) { setMessage("Safe mode keeps every optional subsystem off"); return; }
    try {
      const service = studyRef.current ?? await studyFeature.activate();
      studyRef.current = service;
      setStudy(await service.inspect(verseKey));
      setShowStudy((visible) => !visible);
      setMessage(service.licenses().length ? `Loaded ${service.licenses().length} attributed QUL pack(s)` : "No QUL study packs installed — use quran resources import");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Study pack unavailable"); }
  }, [safeMode, studyFeature, verseKey]);

  const play = useCallback(async () => {
    if (safeMode) { setMessage("Playback is off in safe mode"); return; }
    try {
      const service = studyRef.current ?? await studyFeature.activate();
      studyRef.current = service;
      const rows = await service.recitation(verseKey);
      const url = rows.find((row) => row.audioUrl)?.audioUrl;
      if (!url) { setMessage("Install a licensed QUL recitation pack to play this ayah"); return; }
      if (/^https?:/i.test(url) && getPreference("playbackNetworkAccepted") !== "true") {
        if (!playbackDisclosurePending.current) {
          playbackDisclosurePending.current = true;
          setMessage("This attributed recitation pack uses a network audio URL. Press p again to allow playback; no listening telemetry is sent by quran.sh.");
          return;
        }
        setPreference("playbackNetworkAccepted", "true");
        playbackDisclosurePending.current = false;
      }
      await followRef.current?.stop();
      const player = playerRef.current ?? await playerFeature.activate();
      playerRef.current = player;
      timedRef.current?.dispose();
      timedRef.current = null;
      setActiveWordKey(null);
      const [{ createTimedRecitationSession }, { wordTimingsFromSegments }] = await Promise.all([
        import("../features/audio/timed-session.ts"),
        import("../features/resources/timing.ts"),
      ]);
      const timings = wordTimingsFromSegments(verseKey, rows.flatMap((row) => row.segments ?? []));
      const timingsValid = Boolean(timings);
      setHasTimings(timingsValid);
      const timed = createTimedRecitationSession(player, (key) => key === verseKey ? timings : null);
      timed.subscribe((state) => setActiveWordKey(state.wordKey));
      timedRef.current = timed;
      await player.play(verseKey, url);
      setMessage(timingsValid ? `Playing ${verseKey} with verified word timing · p stops` : `Playing ${verseKey} at ayah level · no verified word timing`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Playback unavailable"); }
  }, [playerFeature, safeMode, studyFeature, verseKey]);

  const toggleSpatial = useCallback(async () => {
    if (safeMode) { setMessage("Spatial rendering is off in safe mode"); return; }
    if (backdropRef.current) {
      renderer.root.remove(backdropRef.current.renderable);
      backdropRef.current = null;
      await spatialFeature.disable();
      setMessage("Spatial illumination off");
      return;
    }
    if (getPreference("spatialDisclosureAccepted") !== "true") {
      if (!spatialDisclosurePending.current) {
        spatialDisclosurePending.current = true;
        setMessage("Spatial mode starts a local WebGPU device and generated terminal-cell scene; it downloads no assets. Press g again to enable it.");
        return;
      }
      setPreference("spatialDisclosureAccepted", "true");
      spatialDisclosurePending.current = false;
    }
    try {
      const backdrop = await spatialFeature.activate();
      backdrop.setReducedMotion(reducedMotion);
      backdrop.setVerse(verseKey, verseId / surah.totalVerses);
      const mushafRow = study?.mushaf.find((row) => row.page && row.line);
      backdrop.setMushafContext(mushafRow ? { page: mushafRow.page!, activeLine: mushafRow.line!, totalLines: Number(mushafRow.raw.total_lines ?? 15) } : null);
      renderer.root.add(backdrop.renderable, 0);
      backdropRef.current = backdrop;
      setMessage("Released OpenTUI Three illumination on · g turns it off");
    } catch (cause) { setMessage(`WebGPU backdrop unavailable: ${cause instanceof Error ? cause.message : "unsupported"}`); }
  }, [reducedMotion, renderer, safeMode, spatialFeature, study?.mushaf, surah.totalVerses, verseId, verseKey]);

  const toggleFollow = useCallback(async () => {
    if (followRef.current) {
      await followRef.current.stop();
      followRef.current = null;
      setMessage("Listening stopped; microphone and model session released");
      return;
    }
    if (safeMode) { setMessage("Microphone is off in safe mode"); return; }
    if (getPreference("followDisclosureAccepted") !== "true") {
      if (!followDisclosurePending.current) {
        followDisclosurePending.current = true;
        setMessage("Follow mode records the microphone for local inference only; audio is not retained. It needs the separate ~104 MiB Tilawa model. Press v again to consent and start.");
        return;
      }
      setPreference("followDisclosureAccepted", "true");
      followDisclosurePending.current = false;
    }
    try {
      playerRef.current?.stop();
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
  }, [navigateTo, recognitionFeature, safeMode]);

  useEffect(() => {
    backdropRef.current?.setVerse(verseKey, verseId / surah.totalVerses);
    const mushafRow = study?.mushaf.find((row) => row.line);
    backdropRef.current?.setMushafContext(mushafRow?.page && mushafRow.line ? { page: mushafRow.page, activeLine: mushafRow.line, totalLines: Number(mushafRow.raw.total_lines ?? 15) } : null);
    if (studyRef.current && showStudy) void studyRef.current.inspect(verseKey).then(setStudy);
  }, [showStudy, study?.mushaf, surah.totalVerses, verseId, verseKey]);

  useEffect(() => () => {
    playerRef.current?.stop();
    timedRef.current?.dispose();
    void followRef.current?.stop();
    if (backdropRef.current) renderer.root.remove(backdropRef.current.renderable);
  }, [renderer]);

  useKeyboard((key) => {
    if (key.sequence === "q") { renderer.destroy(); return; }
    if (key.sequence && ["1", "2", "3", "4"].includes(key.sequence)) { setMode(READING_MODES[Number(key.sequence) - 1]!); return; }
    if (key.sequence === "w") { void inspect(); return; }
    if (key.sequence === "p") { if (["playing", "buffering"].includes(playerRef.current?.getState().status ?? "")) { playerRef.current?.stop(); timedRef.current?.dispose(); timedRef.current = null; setActiveWordKey(null); setMessage("Playback stopped"); } else void play(); return; }
    if (key.sequence === "g") { void toggleSpatial(); return; }
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

  const lineWidth = Math.max(28, Math.min(96, dimensions.width - (showStudy && layout.showAuxiliaryPanel ? 42 : 8)));
  const arabic = useMemo(() => renderArabicVerse(verse.text, 0, lineWidth), [lineWidth, verse.text]);
  const activeWordNumber = activeWordKey && parseWordKey(activeWordKey)?.key.startsWith(`${verseKey}:`) ? parseWordKey(activeWordKey)?.word : null;
  const activeRenderedWord = activeWordNumber ? renderArabicVerse(verse.text.split(/\s+/)[activeWordNumber - 1] ?? "", 0, lineWidth) : "";
  const activeRenderedIndex = activeRenderedWord ? arabic.indexOf(activeRenderedWord) : -1;
  const previous = verseId > 1 ? surah.verses[verseId - 2] : null;
  const next = verseId < surah.totalVerses ? surah.verses[verseId] : null;
  const progressWidth = Math.max(8, Math.min(32, Math.floor(dimensions.width / 4)));
  const filled = Math.round(verseId / surah.totalVerses * progressWidth);

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor="#05070b">
      <box height={3} flexDirection="row" borderStyle="rounded" borderColor="#355663" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <text fg="#d8b45d">{`☾  ${surahId}. ${surah.transliteration} · ${surah.translation}`}</text>
        <text fg="#7797a5">{`${modeLabels[mode]} · ${layout.mode}${safeMode ? " · SAFE" : ""}  ☽`}</text>
      </box>
      <box flexGrow={1} flexDirection="row">
        <box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center" paddingLeft={2} paddingRight={2}>
          {layout.mode !== "compact" && previous && <text fg="#354249">{renderArabicVerse(previous.text, 0, lineWidth)}</text>}
          <box width="100%" minHeight={7} marginTop={1} marginBottom={1} padding={1} borderStyle="double" borderColor={focusGlow < 0.55 ? "#5b4c2d" : "#8b7441"} alignItems="center" justifyContent="center">
            {activeRenderedIndex >= 0 ? (
              <text fg="#f2ead8"><span>{arabic.slice(0, activeRenderedIndex)}</span><span fg="#05070b" bg="#d8b45d">{activeRenderedWord}</span><span>{arabic.slice(activeRenderedIndex + activeRenderedWord.length)}</span></text>
            ) : <text fg="#f2ead8">{arabic}</text>}
          </box>
          {presentation.showTranslation && <text fg="#aeb8b6">{verse.translation}</text>}
          {!presentation.hideNextVerse && layout.mode === "immersive" && next && <text fg="#354249">{renderArabicVerse(next.text, 0, lineWidth)}</text>}
        </box>
        {showStudy && layout.showAuxiliaryPanel && (
          <box width={40} borderStyle="rounded" borderColor="#476672" flexDirection="column" padding={1}>
            <text fg="#d8b45d">{`Study · ${verseKey}`}</text>
            <text fg="#8fa4aa">{study?.tafsir[0]?.text ?? "No tafsir row in installed packs"}</text>
            <text fg="#6f8b91">{study?.topics.map((row) => row.topic).filter(Boolean).join(" · ") || "w closes this pane"}</text>
            <text fg="#7797a5">{study?.words.slice(0, 5).map((row) => `${row.text ?? "word"}${row.root ? ` · root ${row.root}` : ""}`).join("\n")}</text>
          </box>
        )}
      </box>
      <box height={5} borderStyle="rounded" borderColor="#29404d" flexDirection="column" paddingLeft={1} paddingRight={1}>
        <box flexDirection="row" justifyContent="space-between"><text fg="#d8b45d">{`${"━".repeat(filled)}${"─".repeat(progressWidth - filled)}  ${verseKey}`}</text><text fg="#60727a">{`${verseId}/${surah.totalVerses}`}</text></box>
        <text fg="#8fa4aa">{message}</text>
        <text fg="#60727a">{`j/k verse · 1 Focus · 2 Learn · 3 Recite · 4 Memorise · w QUL · p play · v follow · g spatial · M motion · q quit`}</text>
      </box>
    </box>
  );
}
