import { useEffect, useRef } from "react";
import { logVerse } from "../data/log.ts";
import { getPreference, setPreference } from "../data/preferences.ts";

/** Preference shared by every reader so "Track reading" means the same thing everywhere. */
export const TRACK_READING_PREFERENCE = "readingMode";

export function savedTrackReading(): boolean {
  try { return getPreference(TRACK_READING_PREFERENCE) === "true"; } catch { return false; }
}

export function saveTrackReading(enabled: boolean): void {
  try { setPreference(TRACK_READING_PREFERENCE, String(enabled)); } catch { /* DB may be unavailable in tests */ }
}

export interface ReadingTrackerOptions {
  readonly verseKey: `${number}:${number}`;
  readonly enabled: boolean;
  readonly onLogged?: () => void;
}

/**
 * Log reading while tracking is on, whichever way the reader moved: keys,
 * search, cues, go-to or recitation. The verse you arrive at is logged, and
 * the verse you leave is logged once if it was never logged this session
 * (so the ayah you started on counts). Turning tracking on logs the
 * current verse.
 */
export function useReadingTracker({ verseKey, enabled, onLogged }: ReadingTrackerOptions): void {
  const previousKeyRef = useRef(verseKey);
  const previousEnabledRef = useRef(enabled);
  const loggedThisSessionRef = useRef(new Set<string>());
  const onLoggedRef = useRef(onLogged);
  onLoggedRef.current = onLogged;

  useEffect(() => {
    const previousKey = previousKeyRef.current;
    const wasEnabled = previousEnabledRef.current;
    previousKeyRef.current = verseKey;
    previousEnabledRef.current = enabled;
    if (!enabled) return;

    const toLog: string[] = [];
    if (!wasEnabled) toLog.push(verseKey);
    else if (previousKey !== verseKey) {
      if (!loggedThisSessionRef.current.has(previousKey)) toLog.push(previousKey);
      toLog.push(verseKey);
    }
    if (toLog.length === 0) return;
    let logged = false;
    for (const key of toLog) {
      try {
        if (logVerse(key).ok) {
          loggedThisSessionRef.current.add(key);
          logged = true;
        }
      } catch { /* DB may be unavailable in tests */ }
    }
    if (logged) onLoggedRef.current?.();
  }, [enabled, verseKey]);
}
