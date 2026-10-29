import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSurah } from "../data/quran.ts";
import { getPreference, setPreference } from "../data/preferences.ts";
import { getBookmarkedAyahs, toggleBookmark } from "../data/bookmarks.ts";
import { adjacentVerseKey } from "./use-recitation-playback.ts";
import { saveTrackReading, savedTrackReading, useReadingTracker } from "./use-reading-tracker.ts";
import { createReadingTranscript } from "../features/transcript/coordinator.ts";
import { createOpenTuiScrollbackWriter } from "../features/transcript/opentui-adapter.ts";
import {
  getRtlStrategy,
  renderArabicVerseWithStrategy,
  resolveRtlStrategy,
  wrapTerminalWords,
} from "./utils/rtl.ts";

function startingPosition(initialVerseKey?: `${number}:${number}`): { surahId: number; verseId: number } {
  const [surahId, verseId] = (initialVerseKey ?? "1:1").split(":").map(Number);
  return surahId && verseId && getSurah(surahId)?.verses[verseId - 1] ? { surahId, verseId } : { surahId: 1, verseId: 1 };
}

export default function StreamApp({ initialVerseKey }: { readonly initialVerseKey?: `${number}:${number}` } = {}) {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const transcript = useMemo(createReadingTranscript, []);
  const rtlStrategy = useMemo(() => getRtlStrategy() ?? resolveRtlStrategy(getPreference("rtlStrategy")), []);
  const writer = useMemo(
    () => createOpenTuiScrollbackWriter(renderer, { rtlStrategy }),
    [renderer, rtlStrategy],
  );
  const [start] = useState(() => startingPosition(initialVerseKey));
  const [surahId, setSurahId] = useState(start.surahId);
  const [verseId, setVerseId] = useState(start.verseId);
  const [trackReading, setTrackReading] = useState(savedTrackReading);
  const [notice, setNotice] = useState("");
  const [bookmarked, setBookmarked] = useState<Set<number>>(() => {
    try { return getBookmarkedAyahs(start.surahId); } catch { return new Set(); }
  });
  const surah = getSurah(surahId)!;
  const verse = surah.verses[verseId - 1]!;
  const verseKey = `${surahId}:${verseId}` as const;
  const previous = useRef({ surahId, verseId });

  useReadingTracker({ verseKey, enabled: trackReading });

  // Share the reading position with the dashboard and immersive reader.
  useEffect(() => {
    if (initialVerseKey === undefined) return;
    try {
      setPreference("selectedSurahId", String(surahId));
      setPreference("currentVerseId", String(verseId));
    } catch { /* DB may be unavailable */ }
  }, [initialVerseKey, surahId, verseId]);

  useEffect(() => {
    try { setBookmarked(getBookmarkedAyahs(surahId)); } catch { /* DB may be unavailable */ }
  }, [surahId]);

  useEffect(() => {
    const last = previous.current;
    if (last.surahId === surahId && last.verseId === verseId) return;
    const lastSurah = getSurah(last.surahId);
    const lastVerse = lastSurah?.verses[last.verseId - 1];
    if (lastSurah && lastVerse) {
      const entry = transcript.commit({
        verseKey: `${last.surahId}:${last.verseId}`,
        arabic: lastVerse.text,
        translation: lastVerse.translation,
        attribution: "quran-json",
      });
      if (entry) writer.append(entry);
    }
    previous.current = { surahId, verseId };
  }, [surahId, verseId, transcript, writer]);

  useKeyboard((key) => {
    if (key.sequence === "q") { renderer.destroy(); return; }
    const move = key.name === "down" || key.sequence === "j" ? 1
      : key.name === "up" || key.sequence === "k" ? -1
        : 0;
    if (move !== 0) {
      const next = adjacentVerseKey(surahId, verseId, move);
      if (next) {
        const [nextSurah, nextVerse] = next.split(":").map(Number);
        setSurahId(nextSurah!);
        setVerseId(nextVerse!);
        setNotice("");
      }
      return;
    }
    if (key.sequence === "m") {
      const next = !trackReading;
      setTrackReading(next);
      saveTrackReading(next);
      setNotice(next ? "Tracking reading: ON" : "Tracking reading: OFF");
      return;
    }
    if (key.sequence === "b") {
      try {
        const added = toggleBookmark(surahId, verseId, verseKey);
        setBookmarked(getBookmarkedAyahs(surahId));
        setNotice(added ? `Bookmarked ${verseKey}` : `Removed the bookmark on ${verseKey}`);
      } catch {
        setNotice("Bookmarks are unavailable right now");
      }
    }
  });

  const progress = Math.round(verseId / surah.totalVerses * 100);
  const arabicWidth = Math.max(1, dimensions.width - 2);
  const arabicLines = useMemo(
    () => renderArabicVerseWithStrategy(verse.text, rtlStrategy, 0, arabicWidth).split("\n"),
    [arabicWidth, rtlStrategy, verse.text],
  );
  const translationLines = useMemo(
    () => wrapTerminalWords(verse.translation, arabicWidth),
    [arabicWidth, verse.translation],
  );
  const helpLines = useMemo(
    () => wrapTerminalWords(
      `${notice ? `${notice} · ` : ""}j/k navigate · b bookmark · m track reading (${trackReading ? "on" : "off"}) · completed verses stay in terminal scrollback · q quit`,
      arabicWidth,
    ),
    [arabicWidth, notice, trackReading],
  );
  const footerHeight = Math.min(
    renderer.terminalHeight,
    Math.max(6, 1 + arabicLines.length + translationLines.length + helpLines.length),
  );
  useEffect(() => {
    if (renderer.screenMode === "split-footer") renderer.footerHeight = footerHeight;
  }, [footerHeight, renderer]);
  return (
    <box width="100%" height="100%" flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" justifyContent="space-between"><text fg="#d8b45d">{`${surahId}. ${surah.transliteration}${bookmarked.has(verseId) ? `  ★ ${verseKey}` : ""}`}</text><text fg="#7797a5">{`${verseId}/${surah.totalVerses} · ${progress}%`}</text></box>
      <box width="100%" flexDirection="column" alignItems="flex-end">
        {arabicLines.map((line, index) => <text key={index} fg="#f2ead8">{line}</text>)}
      </box>
      {translationLines.map((line, index) => <text key={`translation-${index}`} fg="#9aa6a9">{line}</text>)}
      {helpLines.map((line, index) => <text key={`help-${index}`} fg="#60727a">{line}</text>)}
    </box>
  );
}
