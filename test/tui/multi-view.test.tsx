import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { Reader } from "../../src/tui/components/reader";
import { ThemeProvider } from "../../src/tui/theme";
import { ModeProvider } from "../../src/tui/mode";

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
});
