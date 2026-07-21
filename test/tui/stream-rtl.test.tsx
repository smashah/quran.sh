import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import StreamApp from "../../src/tui/stream-app.tsx";
import { createOpenTuiScrollbackWriter, formatTranscriptEntryForScrollback } from "../../src/features/transcript/opentui-adapter.ts";
import { getSurah, getVerse } from "../../src/data/quran.ts";
import { getVisualWidth, renderArabicVerse, setRtlStrategy, splitArabicGraphemes } from "../../src/tui/utils/rtl.ts";

let setup: TestRendererSetup | undefined;

afterEach(() => {
  if (setup) act(() => setup?.renderer.destroy());
  setup = undefined;
});

describe("stream reader RTL", () => {
  test("renders the live Arabic ayah through the configured RTL strategy", async () => {
    setRtlStrategy("reshaped_reversed");
    const verse = getSurah(1)!.verses[0]!;
    setup = await testRender(<StreamApp />, { width: 100, height: 8 });
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    expect(frame).toContain(renderArabicVerse(verse.text, 0, 96));
    expect(frame).not.toContain(verse.text);
  });

  test("commits visually RTL Arabic to real OpenTUI split-footer scrollback", async () => {
    setRtlStrategy("reshaped_reversed");
    setup = await createTestRenderer({
      width: 80,
      height: 8,
      screenMode: "split-footer",
      footerHeight: 6,
      externalOutputMode: "capture-stdout",
    });
    const arabic = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";
    createOpenTuiScrollbackWriter(setup.renderer).append({
      kind: "verse",
      verse: { verseKey: "1:1", arabic, translation: "In the name of Allah" },
    });
    await setup.flush();

    const commits = setup.externalOutput.take();
    const output = commits.flatMap((commit) => commit.rows).join("\n");
    const flattenedOutput = output.replaceAll("\n", "");
    const renderedArabic = renderArabicVerse(arabic, 0, 80);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ height: 2, startOnNewLine: true, trailingNewline: true });
    expect(flattenedOutput).toContain(renderedArabic);
    expect(flattenedOutput.indexOf("﴿1:1﴾")).toBeLessThan(flattenedOutput.indexOf(renderedArabic));
    expect(output).not.toContain(arabic);
  });

  test("preserves grapheme order and attached Quranic marks while wrapping long ayat", () => {
    const verse = getVerse("2:255")!;
    const marker = "﴿2:255﴾";
    const lines = formatTranscriptEntryForScrollback(
      { kind: "verse", verse: { verseKey: "2:255", arabic: verse.text } },
      32,
      "reversed",
    );
    const reconstructed = lines.map((line, index) => {
      let visual = line.trimStart();
      if (index === lines.length - 1) visual = visual.slice(marker.length + 2);
      return splitArabicGraphemes(visual).reverse().join("");
    }).join(" ").replace(/\s+/g, " ").trim();

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => getVisualWidth(line) <= 32)).toBe(true);
    expect(reconstructed).toBe(verse.text.replace(/\s+/g, " ").trim());
  });
});
