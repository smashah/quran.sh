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
import { APP_DATA_DIR } from "../data/db.ts";
import { STARTER_RECITATION_PACK } from "../features/resources/public-recitation.ts";
import { ChoiceDialog, type DialogChoice } from "./components/choice-dialog.tsx";
import { TerminalIllumination } from "./components/terminal-illumination.tsx";
import { networkPlaybackIdentity } from "../features/audio/network-permission.ts";

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
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [terminalIllumination, setTerminalIllumination] = useState(false);
  const [gpuIllumination, setGpuIllumination] = useState(false);
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
  const packDownloadRef = useRef<AbortController | null>(null);
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

  const inspect = useCallback(async () => {
    if (safeMode) { setMessage("Safe mode keeps every optional subsystem off"); return; }
    try {
      const service = studyRef.current ?? await studyFeature.activate();
      studyRef.current = service;
      setStudy(await service.inspect(verseKey));
      setShowStudy((visible) => !visible);
      setMessage(service.licenses().length ? `Loaded ${service.licenses().length} attributed resource pack(s)` : "No study packs installed — use quran resources import");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Study pack unavailable"); }
  }, [safeMode, studyFeature, verseKey]);

  const startPlayback = useCallback(async (
    rows: Awaited<ReturnType<StudyService["recitation"]>>,
    url: string,
  ) => {
    let network;
    try { network = networkPlaybackIdentity(url, rows.find((row) => row.audioUrl === url)); }
    catch (cause) { setMessage(deepestErrorMessage(cause, "Blocked invalid audio URL")); return; }
    const begin = async () => {
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
    };
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
  }, [playerFeature, verseKey]);

  const installStarterPackAndPlay = useCallback(async () => {
    if (packDownloadRef.current) {
      setMessage("The recitation pack is already downloading");
      return;
    }
    const controller = new AbortController();
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
      const rows = await service.recitation(verseKey);
      const url = rows.find((row) => row.audioUrl)?.audioUrl;
      if (!url) throw new Error("The pack installed but this ayah has no audio mapping. Run `quran resources verify islamic-network.alafasy-128`.");
      setMessage("Recitation index installed and verified");
      setDialog(null);
      await startPlayback(rows, url);
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

  const play = useCallback(async () => {
    if (safeMode) { setMessage("Playback is off in safe mode"); return; }
    try {
      const service = studyRef.current ?? await studyFeature.activate();
      studyRef.current = service;
      const rows = await service.recitation(verseKey);
      const url = rows.find((row) => row.audioUrl)?.audioUrl;
      if (!url) {
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
      await startPlayback(rows, url);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Playback unavailable"); }
  }, [installStarterPackAndPlay, safeMode, startPlayback, studyFeature, verseKey]);

  const enableSpatial = useCallback(async () => {
    let activated: (VisualBackdrop & { renderable: import("@opentui/core").Renderable }) | null = null;
    let attached = false;
    try {
      const backdrop = await spatialFeature.activate();
      activated = backdrop;
      renderer.root.add(backdrop.renderable, 0);
      attached = true;
      backdrop.setReducedMotion(reducedMotion);
      backdrop.setVerse(verseKey, verseId / surah.totalVerses);
      const mushafRow = study?.mushaf.find((row) => row.page && row.line);
      backdrop.setMushafContext(mushafRow ? { page: mushafRow.page!, activeLine: mushafRow.line!, totalLines: Number(mushafRow.raw.total_lines ?? 15) } : null);
      backdropRef.current = backdrop;
      setTerminalIllumination(false);
      setGpuIllumination(true);
      setMessage("3D arch and star illumination on · it responds to surah and ayah progress · g turns it off");
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
          { key: "r", label: "Retry WebGPU", detail: "Useful after changing drivers or the terminal session.", action: () => { setDialog(null); void enableSpatial(); } },
        ],
      });
    }
  }, [reducedMotion, renderer, spatialFeature, study?.mushaf, surah.totalVerses, verseId, verseKey]);

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
    if (getPreference("spatialDisclosureAccepted") !== "true") {
      setDialog({
        title: "Enable spatial illumination?",
        description: [
          "This starts a local WebGPU device and a generated OpenTUI Three scene.",
          "It downloads no assets and records no reading data. A terminal-only fallback is offered if WebGPU fails.",
        ],
        choices: [{
          key: "y",
          label: "Enable 3D arch backdrop",
          action: () => { setDialog(null); setPreference("spatialDisclosureAccepted", "true"); void enableSpatial(); },
        }, {
          key: "f",
          label: "Use terminal arch backdrop",
          detail: "Always available, with no GPU or native dependency.",
          action: () => { setDialog(null); setTerminalIllumination(true); setMessage("Terminal arch illumination on · it follows the active ayah · g turns it off"); },
        }],
      });
      return;
    }
    await enableSpatial();
  }, [enableSpatial, gpuIllumination, renderer, safeMode, spatialFeature, terminalIllumination]);

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
    packDownloadRef.current?.abort(new Error("Reader closed"));
    playerRef.current?.stop();
    timedRef.current?.dispose();
    void followRef.current?.stop();
    if (backdropRef.current) renderer.root.remove(backdropRef.current.renderable);
  }, [renderer]);

  useKeyboard((key) => {
    if (dialog) return;
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
    <box width="100%" height="100%" flexDirection="column" zIndex={1}>
      <box height={3} flexDirection="row" borderStyle="rounded" borderColor="#355663" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <text fg="#d8b45d">{`☾  ${surahId}. ${surah.transliteration} · ${surah.translation}`}</text>
        <text fg="#7797a5">{`${modeLabels[mode]} · ${layout.mode}${gpuIllumination ? " · 3D ARCH" : terminalIllumination ? " · CELL ARCH" : ""}${safeMode ? " · SAFE" : ""}  ☽`}</text>
      </box>
      <box flexGrow={1} flexDirection="row">
        <box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center" paddingLeft={2} paddingRight={2}>
          {layout.mode !== "compact" && previous && <text fg="#354249">{renderArabicVerse(previous.text, 0, lineWidth)}</text>}
          <box width="100%" minHeight={7} marginTop={1} marginBottom={1} padding={1} borderStyle="double" borderColor={terminalIllumination || gpuIllumination ? "#69a6a4" : focusGlow < 0.55 ? "#5b4c2d" : "#8b7441"} alignItems="center" justifyContent="center">
            {terminalIllumination && <TerminalIllumination verseKey={verseKey} />}
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
        <text fg="#60727a">{`j/k verse · 1 Focus · 2 Learn · 3 Recite · 4 Memorise · w study · p play · v follow · g spatial · M motion · q quit`}</text>
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
