import { useKeyboard, useRenderer } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSurah } from "../data/quran.ts";
import { createReadingTranscript } from "../features/transcript/coordinator.ts";
import { createOpenTuiScrollbackWriter } from "../features/transcript/opentui-adapter.ts";

export default function StreamApp() {
  const renderer = useRenderer();
  const transcript = useMemo(createReadingTranscript, []);
  const writer = useMemo(() => createOpenTuiScrollbackWriter(renderer), [renderer]);
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
  return (
    <box width="100%" height="100%" flexDirection="column" paddingLeft={1} paddingRight={1}>
      <box justifyContent="space-between"><text fg="#d8b45d">{`${surahId}. ${surah.transliteration}`}</text><text fg="#7797a5">{`${verseId}/${surah.totalVerses} · ${progress}%`}</text></box>
      <text fg="#f2ead8">{verse.text}</text>
      <text fg="#9aa6a9">{verse.translation}</text>
      <text fg="#60727a">{`j/k navigate · completed verses stay in terminal scrollback · q quit`}</text>
    </box>
  );
}
