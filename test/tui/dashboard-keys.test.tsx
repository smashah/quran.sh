import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import App from "../../src/tui/app";
import { filterCommands } from "../../src/tui/components/command-palette.tsx";
import { HelpDialog } from "../../src/tui/components/help-dialog.tsx";
import { Reader } from "../../src/tui/components/reader";
import { ModeProvider } from "../../src/tui/mode";
import { ThemeProvider } from "../../src/tui/theme";
import { getBookmarkedAyahs, removeBookmark } from "../../src/data/bookmarks.ts";
import { setPreference } from "../../src/data/preferences.ts";
import { FeatureRuntimeProvider, type AnyRuntime } from "../../src/features/react.tsx";
import { createFeatureRuntime } from "../../src/features/runtime.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("command palette filter", () => {
  const commands = [
    { key: "m", label: "Track Reading", description: "Turn reading history on/off" },
    { key: "T", label: "Cycle Theme", description: "Switch dynasty theme" },
    { key: "", label: "Re-calibrate Arabic", description: "Re-run Arabic rendering calibration" },
  ];

  test("matches every typed word against label and description", () => {
    expect(filterCommands(commands, "").length).toBe(3);
    expect(filterCommands(commands, "theme").map((command) => command.label)).toEqual(["Cycle Theme"]);
    expect(filterCommands(commands, "arabic calib").map((command) => command.label)).toEqual(["Re-calibrate Arabic"]);
    expect(filterCommands(commands, "nothing here")).toEqual([]);
  });
});

describe("help dialog", () => {
  test("rows stay readable at 120x35 instead of drawing over each other", async () => {
    const setup = await testRender(
      <ModeProvider><ThemeProvider><HelpDialog visible /></ThemeProvider></ModeProvider>,
      { width: 120, height: 35 },
    );
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Next / previous area: Surahs, Reading stats, Reader, Activity");
    expect(frame).toContain("Move through surahs, verses, search results or list items");
    expect(frame).toContain("Go to a verse or surah");
    act(() => setup.renderer.destroy());
  });
});

describe("search results", () => {
  test("the selected result is marked and clickable", async () => {
    const results = [
      { reference: "2:17", surahId: 2, verseId: 17, surahTransliteration: "Al-Baqarah", translation: "Allah took away their light", text: "", surahName: "" },
      { reference: "24:35", surahId: 24, verseId: 35, surahTransliteration: "An-Nur", translation: "Allah is the Light of the heavens", text: "", surahName: "" },
    ];
    const setup = await testRender(
      <ModeProvider><ThemeProvider>
        <Reader surahId={1} focusedPane="translation" searchResults={results} searchQuery="light" searchSelectedIndex={1} />
      </ThemeProvider></ModeProvider>,
      { width: 90, height: 24 },
    );
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Enter opens the verse");
    expect(frame).toContain("▸ [24:35] An-Nur");
    expect(frame).not.toContain("▸ [2:17]");
    act(() => setup.renderer.destroy());
  });
});

describe("dashboard keys", () => {
  test("study keys work while the sidebar has focus and tracking shows in the status bar", async () => {
    setPreference("rtlStrategy", "reshaped_reversed");
    setPreference("readingMode", "false");
    try { removeBookmark(1, 1); } catch { /* not bookmarked */ }
    const runtime = createFeatureRuntime({}) as AnyRuntime;
    const setup = await testRender(
      <FeatureRuntimeProvider runtime={runtime}><App initialVerseKey="1:1" /></FeatureRuntimeProvider>,
      { width: 120, height: 35 },
    );
    await setup.renderOnce();
    if (setup.captureCharFrame().includes("Arabic Rendering Calibration")) {
      await act(async () => { setup.mockInput.pressEscape(); await settle(); });
      await setup.renderOnce();
    }
    expect(setup.captureCharFrame()).toContain("Focus: Surahs");
    expect(setup.captureCharFrame()).toContain("Tracking: OFF");

    await act(async () => { setup.mockInput.pressKey("b"); await settle(); });
    expect(getBookmarkedAyahs(1).has(1)).toBe(true);

    await act(async () => { setup.mockInput.pressKey("m"); await settle(); });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Tracking: ON");

    await act(async () => { setup.mockInput.pressKey("m"); await settle(); });
    await act(async () => { setup.mockInput.pressTab(); await settle(); });
    await act(async () => { setup.mockInput.pressTab(); await settle(); });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Focus: Reader");

    await act(async () => { setup.mockInput.pressKey(":"); await settle(); });
    await act(async () => { setup.mockInput.typeText("2:255"); await settle(); });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Enter opens Al-Baqarah 2:255");
    await act(async () => { setup.mockInput.pressEnter(); await settle(); });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("2. Al-Baqarah");

    try { removeBookmark(1, 1); } catch { /* cleanup */ }
    act(() => setup.renderer.destroy());
    await runtime.shutdown();
  });
});
