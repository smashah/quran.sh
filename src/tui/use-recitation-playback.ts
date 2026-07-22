import { useCallback, useEffect, useRef, useState } from "react";
import { APP_DATA_DIR } from "../data/db.ts";
import { getSurah } from "../data/quran.ts";
import type { WordKey } from "../domain/quran-coordinate.ts";
import { networkPlaybackIdentity } from "../features/audio/network-permission.ts";
import type { RecitationPlayer, RecitationPlayerState } from "../features/audio/player.ts";
import type { TimedRecitationSession } from "../features/audio/timed-session.ts";
import { useFeatureCommand } from "../features/react.tsx";
import { STARTER_RECITATION_PACK } from "../features/resources/public-recitation.ts";
import type { ResourceRow } from "../features/resources/repository.ts";
import type { StudyService } from "../features/study/service.ts";
import type { ChoiceDialogState } from "./components/choice-dialog.tsx";
import { IDLE_PLAYBACK_VISUAL, type PlaybackVisualState } from "./components/playback-status.tsx";

const PLAYBACK_NAVIGATION_DEBOUNCE_MS = 180;
export type PlaybackNavigationIntent = "manual" | "completion";

export interface RecitationPlaybackController {
  readonly activeWordKey: WordKey | null;
  readonly hasTimings: boolean;
  readonly isFollowing: boolean;
  readonly visual: PlaybackVisualState;
  play(options?: { readonly allowOnlineSources?: boolean; readonly offerPack?: boolean }): Promise<void>;
  stop(): void;
  toggle(options?: { readonly allowOnlineSources?: boolean }): Promise<void>;
}

export interface UseRecitationPlaybackOptions {
  readonly verseKey: `${number}:${number}`;
  readonly safeMode?: boolean;
  readonly onlineSourcesAccepted: boolean;
  readonly onNavigate: (verseKey: `${number}:${number}`, intent: PlaybackNavigationIntent) => void;
  readonly onMessage: (message: string) => void;
  readonly onDialog: (dialog: ChoiceDialogState | null) => void;
}

function playbackDuration(rows: readonly ResourceRow[]): number | null {
  const duration = rows.flatMap((row) => row.segments ?? []).reduce((largest, segment) => Math.max(largest, segment[2]), 0);
  return duration > 0 ? duration : null;
}

function playbackVisualFrom(state: RecitationPlayerState, durationMs: number | null): PlaybackVisualState {
  if (state.status === "playing") return { status: "playing", elapsedMs: state.elapsedMs, bufferedMs: state.bufferedMs, durationMs };
  if (state.status === "buffering") return { status: "buffering", elapsedMs: 0, bufferedMs: 0, durationMs };
  return IDLE_PLAYBACK_VISUAL;
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

export function adjacentVerseKey(surahId: number, verseId: number, direction: 1 | -1): `${number}:${number}` | null {
  const surah = getSurah(surahId);
  if (!surah) return null;
  const nextVerse = verseId + direction;
  if (nextVerse >= 1 && nextVerse <= surah.totalVerses) return `${surahId}:${nextVerse}`;
  const adjacentSurahId = surahId + direction;
  const adjacentSurah = getSurah(adjacentSurahId);
  if (!adjacentSurah) return null;
  return `${adjacentSurahId}:${direction === 1 ? 1 : adjacentSurah.totalVerses}`;
}

export function useRecitationPlayback(options: UseRecitationPlaybackOptions): RecitationPlaybackController {
  const { onDialog, onMessage, onNavigate, safeMode, verseKey } = options;
  const playerFeature = useFeatureCommand<RecitationPlayer>("recitation");
  const studyFeature = useFeatureCommand<StudyService>("study");
  const [isFollowing, setIsFollowing] = useState(false);
  const [activeWordKey, setActiveWordKey] = useState<WordKey | null>(null);
  const [hasTimings, setHasTimings] = useState(false);
  const [visual, setVisual] = useState<PlaybackVisualState>(IDLE_PLAYBACK_VISUAL);
  const playerRef = useRef<RecitationPlayer | null>(null);
  const studyRef = useRef<StudyService | null>(null);
  const timedRef = useRef<TimedRecitationSession | null>(null);
  const playbackSubscriptionRef = useRef<(() => void) | null>(null);
  const playbackRequestRef = useRef(0);
  const preloadRequestRef = useRef(0);
  const navigationIntentRef = useRef<PlaybackNavigationIntent>("manual");
  const verseKeyRef = useRef<string>(verseKey);
  const playModeRef = useRef(false);
  const onlineSourcesAcceptedRef = useRef(options.onlineSourcesAccepted);
  const packDownloadRef = useRef<AbortController | null>(null);
  const timedRecitationRequestRef = useRef<AbortController | null>(null);
  const timedPreloadRequestRef = useRef<AbortController | null>(null);
  const clearTimedRecitationCacheRef = useRef<(() => void) | null>(null);
  verseKeyRef.current = verseKey;
  onlineSourcesAcceptedRef.current = options.onlineSourcesAccepted || onlineSourcesAcceptedRef.current;

  const setFollowing = useCallback((enabled: boolean) => {
    playModeRef.current = enabled;
    setIsFollowing(enabled);
  }, []);

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
        const provider = await import("../features/audio/timed-recitation-provider.ts");
        clearTimedRecitationCacheRef.current = provider.clearTimedRecitationCache;
        const row = await provider.fetchTimedRecitation(nextKey, { signal: controller.signal });
        if (controller.signal.aborted || request !== preloadRequestRef.current || !playModeRef.current || !row.audioUrl) return;
        networkPlaybackIdentity(row.audioUrl, row);
        await player.preload?.(nextKey, row.audioUrl);
        return;
      } catch {
        if (controller.signal.aborted || request !== preloadRequestRef.current || !playModeRef.current) return;
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
      if (!row?.audioUrl || request !== preloadRequestRef.current || !playModeRef.current) return;
      networkPlaybackIdentity(row.audioUrl, row);
      await player.preload?.(nextKey, row.audioUrl);
    } catch {
      // Preloading is opportunistic; foreground playback owns recovery.
    }
  }, [studyFeature]);

  const startPlayback = useCallback(async (
    requestedKey: string,
    rows: readonly ResourceRow[],
    url: string,
    playbackRequest: number,
  ) => {
    try { networkPlaybackIdentity(url, rows.find((row) => row.audioUrl === url)); }
    catch (cause) { throw new Error(deepestErrorMessage(cause, "Blocked invalid audio URL"), { cause }); }
    const begin = async () => {
      const isCurrentRequest = () => playbackRequestRef.current === playbackRequest && verseKeyRef.current === requestedKey;
      if (!isCurrentRequest()) return;
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
      setVisual({ status: "loading", elapsedMs: 0, bufferedMs: 0, durationMs });
      const timed = createTimedRecitationSession(player, (key) => key === requestedKey ? timings : null);
      timed.subscribe((state) => setActiveWordKey(state.wordKey));
      timedRef.current = timed;
      playbackSubscriptionRef.current?.();
      let unsubscribePlayback = () => {};
      unsubscribePlayback = player.subscribe((state) => {
        if (!("verseKey" in state) || state.verseKey !== requestedKey || !isCurrentRequest()) return;
        if (state.status === "playing" || state.status === "buffering") setVisual(playbackVisualFrom(state, durationMs));
        if (state.status === "ended" && playModeRef.current) {
          unsubscribePlayback();
          if (playbackSubscriptionRef.current === unsubscribePlayback) playbackSubscriptionRef.current = null;
          timedRef.current?.dispose();
          timedRef.current = null;
          setActiveWordKey(null);
          setHasTimings(false);
          setVisual(IDLE_PLAYBACK_VISUAL);
          const [currentSurah, currentVerse] = requestedKey.split(":").map(Number);
          const nextKey = currentSurah && currentVerse ? adjacentVerseKey(currentSurah, currentVerse, 1) : null;
          if (nextKey) {
            navigationIntentRef.current = "completion";
            onMessage(`Completed ${requestedKey} · continuing with ${nextKey}…`);
            onNavigate(nextKey, "completion");
          } else {
            preloadRequestRef.current++;
            setFollowing(false);
            player.clearPreload?.();
            onMessage(`Completed ${requestedKey} · reached the end of the Quran`);
          }
          return;
        }
        if (state.status !== "error") return;
        unsubscribePlayback();
        if (playbackSubscriptionRef.current === unsubscribePlayback) playbackSubscriptionRef.current = null;
        preloadRequestRef.current++;
        setFollowing(false);
        player.clearPreload?.();
        timedRef.current?.dispose();
        timedRef.current = null;
        setActiveWordKey(null);
        setHasTimings(false);
        setVisual(IDLE_PLAYBACK_VISUAL);
        onMessage(`${state.message} · playback stopped at ${requestedKey}`);
        onDialog({
          title: "Audio stream unavailable",
          description: [state.message, `Playback stopped at ${requestedKey}; no earlier stream remains active.`],
          choices: [{ key: "r", label: "Retry this ayah", action: () => { onDialog(null); void begin(); } }, {
            key: "c", label: "Continue reading", action: () => { onDialog(null); onMessage("Playback remains off; reading position preserved"); },
          }],
        });
      });
      playbackSubscriptionRef.current = unsubscribePlayback;
      if (!isCurrentRequest()) {
        timed.dispose();
        if (timedRef.current === timed) timedRef.current = null;
        setVisual(IDLE_PLAYBACK_VISUAL);
        return;
      }
      setFollowing(true);
      await player.play(requestedKey, url);
      if (!isCurrentRequest() || !playModeRef.current) return;
      onMessage(timingsValid
        ? `Following ${requestedKey} with verified word timing · next ayah preloading`
        : `Following ${requestedKey} at ayah level · next ayah preloading`);
      void preloadFollowingAyah(requestedKey, player);
    };
    if (playbackRequestRef.current !== playbackRequest || verseKeyRef.current !== requestedKey) return;
    await begin();
  }, [onDialog, onMessage, onNavigate, playerFeature, preloadFollowingAyah, setFollowing]);

  const playRowsWithOptionalTiming = useCallback(async (
    requestedKey: string,
    rows: readonly ResourceRow[],
    fallbackUrl: string | undefined,
    playbackRequest: number,
  ): Promise<boolean> => {
    const isCurrentRequest = () => playbackRequestRef.current === playbackRequest && verseKeyRef.current === requestedKey;
    if (!isCurrentRequest()) return false;
    if (!onlineSourcesAcceptedRef.current) {
      if (!fallbackUrl) return false;
      await startPlayback(requestedKey, rows, fallbackUrl, playbackRequest);
      return true;
    }
    timedRecitationRequestRef.current?.abort(new Error("Replaced by a newer timed-recitation request"));
    const controller = new AbortController();
    timedRecitationRequestRef.current = controller;
    onMessage(`Loading verified word timing for ${requestedKey}…`);
    try {
      const provider = await import("../features/audio/timed-recitation-provider.ts");
      clearTimedRecitationCacheRef.current = provider.clearTimedRecitationCache;
      const timedRow = await provider.fetchTimedRecitation(requestedKey, { signal: controller.signal });
      if (!isCurrentRequest() || controller.signal.aborted || !timedRow.audioUrl) return false;
      await startPlayback(requestedKey, [timedRow], timedRow.audioUrl, playbackRequest);
      return true;
    } catch (cause) {
      if (!isCurrentRequest() || controller.signal.aborted) return false;
      if (!fallbackUrl) return false;
      onMessage(`${deepestErrorMessage(cause, "Verified word timing is unavailable")} · continuing at ayah level`);
      await startPlayback(requestedKey, rows, fallbackUrl, playbackRequest);
      return true;
    } finally {
      if (timedRecitationRequestRef.current === controller) timedRecitationRequestRef.current = null;
    }
  }, [onMessage, startPlayback]);

  const installStarterPackAndPlay = useCallback(async () => {
    if (packDownloadRef.current) {
      onMessage("The recitation pack is already downloading");
      return;
    }
    const controller = new AbortController();
    const requestedKey = verseKeyRef.current;
    const playbackRequest = ++playbackRequestRef.current;
    packDownloadRef.current = controller;
    const cancel = () => {
      controller.abort(new Error("Cancelled by the reader"));
      onMessage("Cancelling the recitation-pack download…");
    };
    onDialog({
      title: "Downloading recitation pack",
      description: ["Starting the bounded, checksum-pinned download…"],
      choices: [{ key: "c", label: "Cancel download", action: cancel }],
      onDismiss: cancel,
    });
    onMessage(`Downloading the ${STARTER_RECITATION_PACK.provider} streaming index…`);
    try {
      const { installStarterRecitationPack } = await import("../features/resources/public-recitation.ts");
      await installStarterRecitationPack(APP_DATA_DIR, {
        signal: controller.signal,
        onProgress: (received, total) => {
          const progress = `${Math.round(received / 1024)}${total ? `/${Math.round(total / 1024)}` : ""} KiB`;
          onMessage(`Downloading recitation index · ${progress}`);
          onDialog({
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
      onMessage("Recitation index installed and verified");
      onDialog(null);
      await playRowsWithOptionalTiming(requestedKey, rows, url, playbackRequest);
    } catch (cause) {
      const cancelled = controller.signal.aborted || (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "cancelled");
      if (cancelled) {
        onDialog(null);
        onMessage("Recitation-pack download cancelled; press p whenever you are ready to retry");
        return;
      }
      const detail = cause instanceof Error ? cause.message : "The recitation pack could not be installed";
      onMessage(detail);
      onDialog({
        title: "Download did not finish",
        description: [detail, "Check the connection and retry here, or run `quran resources install starter-audio` later."],
        choices: [{ key: "r", label: "Retry download", action: () => void installStarterPackAndPlay() }],
      });
    } finally {
      if (packDownloadRef.current === controller) packDownloadRef.current = null;
    }
  }, [onDialog, onMessage, playRowsWithOptionalTiming, studyFeature]);

  const playVerse = useCallback(async (requestedKey: string, offerPack: boolean) => {
    if (safeMode) { setFollowing(false); setVisual(IDLE_PLAYBACK_VISUAL); onMessage("Playback is off in safe mode"); return; }
    const playbackRequest = ++playbackRequestRef.current;
    try {
      const service = studyRef.current ?? await studyFeature.activate();
      if (playbackRequestRef.current !== playbackRequest || verseKeyRef.current !== requestedKey) return;
      studyRef.current = service;
      const rows = await service.recitation(requestedKey);
      if (playbackRequestRef.current !== playbackRequest || verseKeyRef.current !== requestedKey) return;
      const url = rows.find((row) => row.audioUrl)?.audioUrl;
      if (await playRowsWithOptionalTiming(requestedKey, rows, url, playbackRequest)) return;
      if (!url) {
        if (!offerPack) {
          setFollowing(false);
          setVisual(IDLE_PLAYBACK_VISUAL);
          playerRef.current?.clearPreload?.();
          playbackSubscriptionRef.current?.();
          playbackSubscriptionRef.current = null;
          onDialog({
            title: "Playback paused",
            description: [`The installed recitation source has no audio mapping for ${requestedKey}.`, "The reader stayed on the requested ayah and stopped every previous stream."],
            choices: [{ key: "r", label: "Retry current ayah", action: () => { onDialog(null); void playVerse(requestedKey, false); } }, {
              key: "s", label: "Stop play mode", action: () => { onDialog(null); onMessage("Playback stopped; reading position preserved"); },
            }],
          });
          return;
        }
        setFollowing(false);
        setVisual(IDLE_PLAYBACK_VISUAL);
        onDialog({
          title: "Download a recitation pack?",
          description: [
            `${STARTER_RECITATION_PACK.reciter} · 128 kbps · ${STARTER_RECITATION_PACK.provider}`,
            "This downloads and verifies a ~607 KiB verse index. Audio streams only when you press play.",
            "Provider terms allow personal/educational, non-commercial listening; the reciter retains copyright.",
            "This is an offline fallback index; the accepted Quran.com source is normally tried first for synchronized playback.",
          ],
          choices: [{ key: "d", label: "Download pack", detail: "License and attribution are stored with the installed pack.", action: () => void installStarterPackAndPlay() }],
        });
      }
    } catch (cause) {
      if (playbackRequestRef.current !== playbackRequest || verseKeyRef.current !== requestedKey) return;
      setFollowing(false);
      setVisual(IDLE_PLAYBACK_VISUAL);
      playerRef.current?.clearPreload?.();
      playbackSubscriptionRef.current?.();
      playbackSubscriptionRef.current = null;
      const detail = cause instanceof Error ? cause.message : "Playback unavailable";
      onDialog({
        title: "Playback paused",
        description: [detail, "The current ayah remains selected and every earlier stream has been stopped."],
        choices: [{ key: "r", label: "Retry current ayah", action: () => { onDialog(null); void playVerse(requestedKey, offerPack); } }, {
          key: "s", label: "Stop play mode", action: () => { onDialog(null); onMessage("Playback stopped; reading position preserved"); },
        }],
      });
    }
  }, [installStarterPackAndPlay, onDialog, onMessage, playRowsWithOptionalTiming, safeMode, setFollowing, studyFeature]);

  const stop = useCallback(() => {
    playbackRequestRef.current++;
    preloadRequestRef.current++;
    timedRecitationRequestRef.current?.abort(new Error("Playback stopped"));
    timedPreloadRequestRef.current?.abort(new Error("Playback stopped"));
    setFollowing(false);
    playerRef.current?.stop();
    playerRef.current?.clearPreload?.();
    playbackSubscriptionRef.current?.();
    playbackSubscriptionRef.current = null;
    timedRef.current?.dispose();
    timedRef.current = null;
    setActiveWordKey(null);
    setHasTimings(false);
    setVisual(IDLE_PLAYBACK_VISUAL);
    onMessage("Playback stopped; reading position preserved");
  }, [onMessage, setFollowing]);

  const play = useCallback(async (playOptions: { readonly allowOnlineSources?: boolean; readonly offerPack?: boolean } = {}) => {
    if (playOptions.allowOnlineSources) onlineSourcesAcceptedRef.current = true;
    setFollowing(true);
    setVisual({ status: "loading", elapsedMs: 0, bufferedMs: 0, durationMs: null });
    await playVerse(verseKeyRef.current, playOptions.offerPack ?? true);
  }, [playVerse, setFollowing]);

  const toggle = useCallback(async (toggleOptions: { readonly allowOnlineSources?: boolean } = {}) => {
    if (playModeRef.current) stop();
    else await play({ ...toggleOptions, offerPack: true });
  }, [play, stop]);

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
    setVisual(IDLE_PLAYBACK_VISUAL);
    onMessage(intent === "completion" ? `Continuing with ${verseKey}…` : `Moving playback to ${verseKey}…`);
    if (intent === "completion") {
      void playVerse(verseKey, false);
      return;
    }
    const timer = setTimeout(() => void playVerse(verseKey, false), PLAYBACK_NAVIGATION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [onMessage, playVerse, verseKey]);

  useEffect(() => () => {
    packDownloadRef.current?.abort(new Error("Reader closed"));
    timedRecitationRequestRef.current?.abort(new Error("Reader closed"));
    timedPreloadRequestRef.current?.abort(new Error("Reader closed"));
    playbackRequestRef.current++;
    preloadRequestRef.current++;
    playerRef.current?.stop();
    playerRef.current?.clearPreload?.();
    playbackSubscriptionRef.current?.();
    timedRef.current?.dispose();
    clearTimedRecitationCacheRef.current?.();
  }, []);

  return { activeWordKey, hasTimings, isFollowing, visual, play, stop, toggle };
}
