import { describe, expect, test } from "bun:test";
import { evaluateProbe, parsePeakRss, performanceReportMarkdown } from "../../src/features/performance/report.ts";

describe("performance gates", () => {
  test("classifies warning and blocking thresholds", () => {
    expect(evaluateProbe("startupChunk", 1).status).toBe("pass");
    expect(evaluateProbe("startupChunk", 20_000).status).toBe("warning");
    expect(evaluateProbe("startupChunk", 40_000).status).toBe("fail");
  });

  test("emits a compact machine-derived report", () => {
    const markdown = performanceReportMarkdown({
      generatedAt: "2026-07-21T00:00:00.000Z",
      runtime: { bun: "1.3.14", platform: "darwin", release: "test", arch: "arm64" },
      mode: "bundle",
      probes: [evaluateProbe("helpWallTime", 42)],
    });
    expect(markdown).toContain("| helpWallTime | 42.00 ms |");
    expect(markdown).toContain("Bun 1.3.14");
  });

  test("parses macOS bytes and Linux kilobytes without conflating them", () => {
    expect(parsePeakRss("  23396352  maximum resident set size", "darwin")).toBe(23_396_352);
    expect(parsePeakRss("Maximum resident set size (kbytes): 22848", "linux")).toBe(23_396_352);
    expect(parsePeakRss("unsupported", "win32")).toBeNull();
  });
});
