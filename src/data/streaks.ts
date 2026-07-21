import { openDatabase } from "./db.ts";

export interface StreakStats {
  currentStreak: number;
  longestStreak: number;
  totalDays: number;
  lastReadDate: string | null;
  activityGrid: Record<string, number>; // Date -> Count
}

/**
 * Calculate streak statistics from a list of sorted unique dates (YYYY-MM-DD).
 * @param dates Sorted array of unique date strings
 * @param today Optional "today" date for testing (default: current UTC date)
 */
export function calculateStreaks(dates: string[], today?: string): { currentStreak: number, longestStreak: number } {
  if (dates.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  // Ensure unique and sorted just in case
  const sorted = [...new Set(dates)].sort();
  
  let longestStreak = 0;
  let tempStreak = 0;
  
  // Calculate longest streak
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) {
      tempStreak = 1;
    } else {
      const prev = new Date(sorted[i - 1]!);
      const curr = new Date(sorted[i]!);
      const diffTime = curr.getTime() - prev.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays === 1) {
        tempStreak++;
      } else {
        tempStreak = 1;
      }
    }
    if (tempStreak > longestStreak) {
      longestStreak = tempStreak;
    }
  }

  // Calculate current streak
  // We need to know "today" to check if the streak is active.
  const now = today ? new Date(today) : new Date();
  const todayStr = now.toISOString().split('T')[0]!;
  const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0]!;
  
  const lastDate = sorted[sorted.length - 1];
  let currentStreak = 0;

  // Streak is active if last read was today or yesterday
  if (lastDate === todayStr || lastDate === yesterday) {
     currentStreak = 1;
     for (let i = sorted.length - 1; i > 0; i--) {
        const curr = new Date(sorted[i]!);
        const prev = new Date(sorted[i - 1]!);
        const diffTime = curr.getTime() - prev.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) {
            currentStreak++;
        } else {
            break;
        }
     }
  }

  return { currentStreak, longestStreak };
}

export function getReadingStats(): StreakStats {
  const db = openDatabase();
  // Get all unique reading dates
  const query = db.query(`
      SELECT 
        strftime('%Y-%m-%d', read_at) as date,
        COUNT(*) as count
      FROM reading_log 
      GROUP BY date
      ORDER BY date ASC
    `);
    
  const rows = query.all() as { date: string, count: number }[];
  const activityGrid: Record<string, number> = {};
  for (const row of rows) {
    activityGrid[row.date] = row.count;
  }

  const dates = rows.map(r => r.date);
  const { currentStreak, longestStreak } = calculateStreaks(dates);

  return {
    currentStreak,
    longestStreak,
    totalDays: dates.length,
    lastReadDate: dates.at(-1) ?? null,
    activityGrid
  };
}
