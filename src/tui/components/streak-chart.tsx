import { getReadingStats } from "../../data/streaks.ts";
import { useTheme } from "../theme";

export function StreakChart() {
  const { theme } = useTheme();
  const stats = getReadingStats();
  const { activityGrid } = stats;

  const days = Array.from({ length: 28 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (27 - i));
    return d.toISOString().split('T')[0] ?? "";
  });

  const getSymbol = (count: number) => {
    if (count === 0) return "\u2591";
    if (count < 5) return "\u2593";
    return "\u2588";
  };

  const getColor = (count: number) => {
    if (count === 0) return theme.colors.muted;
    if (count < 5) return theme.colors.primary;
    if (count < 10) return theme.colors.header;
    return theme.colors.highlight;
  };

  return (
    <box flexDirection="column" borderStyle={theme.borderStyle} borderColor={theme.colors.border} customBorderChars={theme.borderChars} padding={1}>
      <text fg={theme.colors.header}>
        <strong>Reading Activity</strong>
      </text>
      
      <box flexDirection="row" marginTop={1} marginBottom={1}>
        <text fg={theme.colors.highlight}>Streak: {stats.currentStreak} </text>
        <text fg={theme.colors.secondary} marginLeft={2}>Best: {stats.longestStreak} </text>
      </box>

      <box flexDirection="row" flexWrap="wrap" width="100%">
         {days.map((date) => {
            const count = activityGrid[date] || 0;
            return <text key={date} fg={getColor(count)}>{getSymbol(count)}</text>;
         })}
      </box>
    </box>
  );
};
