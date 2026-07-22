import { TextAttributes } from "@opentui/core";

export interface PlaybackVisualState {
  readonly status: "idle" | "loading" | "buffering" | "playing";
  readonly elapsedMs: number;
  readonly bufferedMs: number;
  readonly durationMs: number | null;
}

export const IDLE_PLAYBACK_VISUAL: PlaybackVisualState = {
  status: "idle",
  elapsedMs: 0,
  bufferedMs: 0,
  durationMs: null,
};

function formatClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function PlaybackStatus({
  value,
  verseKey,
  activeWord,
  totalWords,
  width,
  timed,
  compact = false,
}: {
  readonly value: PlaybackVisualState;
  readonly verseKey: string;
  readonly activeWord: number | null;
  readonly totalWords: number;
  readonly width: number;
  readonly timed: boolean;
  readonly compact?: boolean;
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
  const content = (
    <>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <text fg="#62c2b8" attributes={TextAttributes.BOLD}>{`▶ ${label} · ${verseKey}`}</text>
        <text fg="#78908d">{`${clock} · next ayah readying`}</text>
      </box>
      <text fg="#d8b45d">{`${"━".repeat(filled)}${"─".repeat(Math.max(0, barWidth - filled))}`}</text>
    </>
  );
  return compact ? (
    <box width="100%" height={2} flexDirection="column" paddingLeft={1} paddingRight={1} backgroundColor="#081017">
      {content}
    </box>
  ) : (
    <box width={width} height={4} borderStyle="single" borderColor="#315a57" flexDirection="column" paddingLeft={1} paddingRight={1}>
      {content}
    </box>
  );
}
