import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { Reader } from "../../src/tui/components/reader";
import { ThemeProvider } from "../../src/tui/theme";
import { ModeProvider } from "../../src/tui/mode";
import { loadLanguage } from "../../src/data/quran.ts";
import { act } from "react";

describe("Multi-View Reader", () => {
  test("renders Arabic by default (or when enabled)", async () => {
    const { captureSpans, renderOnce } = await testRender(
      <ModeProvider><ThemeProvider>
        <Reader surahId={1} focusedPane="arabic" showArabic={true} />
      </ThemeProvider></ModeProvider>,
      {}
    );
    await renderOnce();

    const output = captureSpans().lines
      .map((line) => line.spans.map((s) => s.text).join(""))
      .join("\n");

    // Reshaping produces Arabic Presentation Forms B chars (U+FE70–U+FEFF).
    // Match any PFB character to confirm reshaping is active.
    expect(output).toMatch(/[\uFE70-\uFEFF]/);
  });

  test("hides Arabic when disabled", async () => {
    const { captureSpans, renderOnce } = await testRender(
      <ModeProvider><ThemeProvider>
        <Reader surahId={1} focusedPane="translation" showArabic={false} />
      </ThemeProvider></ModeProvider>,
      {}
    );
    await renderOnce();

    const output = captureSpans().lines
      .map((line) => line.spans.map((s) => s.text).join(""))
      .join("\n");

    // Should NOT contain Arabic Bismillah
    expect(output).not.toContain("بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ");
    // Should still contain translation
    expect(output).toContain("In the name of Allah");
  });

  test("shows transliteration when enabled", async () => {
    const { captureSpans, renderOnce } = await testRender(
      <ModeProvider><ThemeProvider>
        <Reader surahId={1} focusedPane="transliteration" showTransliteration={true} />
      </ThemeProvider></ModeProvider>,
      {}
    );
    await renderOnce();

    const output = captureSpans().lines
      .map((line) => line.spans.map((s) => s.text).join(""))
      .join("\n");

    // Check for transliteration
    expect(output).toContain("Bismi Allahi alrrahmani alrraheemi");
  });

  test("switches language to French", async () => {
    await loadLanguage("fr");
    const { captureSpans, renderOnce } = await testRender(
      <ModeProvider><ThemeProvider>
        <Reader surahId={1} focusedPane="translation" language="fr" />
      </ThemeProvider></ModeProvider>,
      {}
    );
    await renderOnce();

    const output = captureSpans().lines
      .map((line) => line.spans.map((s) => s.text).join(""))
      .join("\n");

    // Check for French translation
    expect(output).toContain("Au nom d'Allah");
  });

  test("keeps Quran content and focus across narrow, standard, and wide cell matrices", async () => {
    const setup = await testRender(
      <ModeProvider><ThemeProvider>
        <Reader surahId={1} focusedPane="arabic" currentVerseId={1} showArabic showTranslation />
      </ThemeProvider></ModeProvider>,
      { width: 71, height: 24 },
    );
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toMatch(/[\uFE70-\uFEFF]/);
    expect(setup.renderer.currentFocusedRenderable).not.toBeNull();
    for (const width of [72, 119, 120]) {
      await act(async () => { setup.resize(width, 32); await setup.renderOnce(); });
      const frame = setup.captureCharFrame();
      expect(frame, `width ${width}`).toContain("Al-Fatihah");
      expect(frame, `width ${width}`).toMatch(/[\uFE70-\uFEFF]/);
      expect(setup.renderer.currentFocusedRenderable, `focus at width ${width}`).not.toBeNull();
    }
    act(() => setup.renderer.destroy());
  });

  test("search results preserve verse provenance and selectable text", async () => {
    const result = { reference: "1:1", translation: "In the name of Allah", text: "بِسْمِ", transliteration: "Bismi", surah: 1, ayah: 1 } as never;
    const { captureCharFrame, renderOnce, renderer } = await testRender(
      <ModeProvider><ThemeProvider>
        <Reader surahId={1} focusedPane="translation" searchResults={[result]} searchQuery="name" />
      </ThemeProvider></ModeProvider>,
      { width: 72, height: 20 },
    );
    await renderOnce();
    expect(captureCharFrame()).toContain("[1:1]");
    expect(captureCharFrame()).toContain("In the name of Allah");
    act(() => renderer.destroy());
  });
});
