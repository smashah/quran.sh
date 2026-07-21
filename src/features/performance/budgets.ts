export interface PerformanceBudget {
  readonly warning: number;
  readonly blocking: number;
  readonly unit: "ms" | "bytes";
}

export const PERFORMANCE_BUDGETS = {
  helpWallTime: { warning: 150, blocking: 300, unit: "ms" },
  helpPeakRss: { warning: 64 * 1024 * 1024, blocking: 96 * 1024 * 1024, unit: "bytes" },
  startupChunk: { warning: 16 * 1024, blocking: 32 * 1024, unit: "bytes" },
  packageJsBytes: { warning: 64 * 1024 * 1024, blocking: 80 * 1024 * 1024, unit: "bytes" },
  binaryBytes: { warning: 160 * 1024 * 1024, blocking: 220 * 1024 * 1024, unit: "bytes" },
  // Bun's allocator retains freed pages for reuse; this catches monotonic leaks,
  // while allowing the settled allocator high-water mark after 20 cycles.
  fakePostUnloadRssDelta: { warning: 64 * 1024 * 1024, blocking: 96 * 1024 * 1024, unit: "bytes" },
  cleanupLatency: { warning: 100, blocking: 500, unit: "ms" },
} as const satisfies Record<string, PerformanceBudget>;

export type PerformanceBudgetId = keyof typeof PERFORMANCE_BUDGETS;
