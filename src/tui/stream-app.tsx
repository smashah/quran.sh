import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSurah } from "../data/quran.ts";
import { getPreference } from "../data/preferences.ts";
import { createReadingTranscript } from "../features/transcript/coordinator.ts";
import { createOpenTuiScrollbackWriter } from "../features/transcript/opentui-adapter.ts";
import {
  getRtlStrategy,
  renderArabicVerseWithStrategy,
  resolveRtlStrategy,
  wrapTerminalWords,
} from "./utils/rtl.ts";

export default function StreamApp() {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const transcript = useMemo(createReadingTranscript, []);
  const rtlStrategy = useMemo(() => getRtlStrategy() ?? resolveRtlStrategy(getPreference("rtlStrategy")), []);
  const writer = useMemo(
    () => createOpenTuiScrollbackWriter(renderer, { rtlStrategy }),
    [renderer, rtlStrategy],
  );
  const [surahId, setSurahId] = useState(1);
  const [verseId, setVerseId] = useState(1);
  const surah = getSurah(surahId)!;
  const verse = surah.verses[verseId - 1]!;
  const previous = useRef({ surahId, verseId });

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
    if (key.name === "down" || key.sequence === "j") {
      if (verseId < surah.totalVerses) setVerseId((value) => value + 1);
      else if (surahId < 114) { setSurahId((value) => value + 1); setVerseId(1); }
    }
    if (key.name === "up" || key.sequence === "k") {
      if (verseId > 1) setVerseId((value) => value - 1);
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
    () => wrapTerminalWords("j/k navigate · completed verses stay in terminal scrollback · q quit", arabicWidth),
    [arabicWidth],
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
      <box flexDirection="row" justifyContent="space-between"><text fg="#d8b45d">{`${surahId}. ${surah.transliteration}`}</text><text fg="#7797a5">{`${verseId}/${surah.totalVerses} · ${progress}%`}</text></box>
      <box width="100%" flexDirection="column" alignItems="flex-end">
        {arabicLines.map((line, index) => <text key={index} fg="#f2ead8">{line}</text>)}
      </box>
      {translationLines.map((line, index) => <text key={`translation-${index}`} fg="#9aa6a9">{line}</text>)}
      {helpLines.map((line, index) => <text key={`help-${index}`} fg="#60727a">{line}</text>)}
    </box>
  );
}
