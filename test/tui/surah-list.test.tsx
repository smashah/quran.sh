import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { SurahList } from "../../src/tui/components/surah-list";
import { ThemeProvider } from "../../src/tui/theme";
import { ModeProvider } from "../../src/tui/mode";

describe("SurahList", () => {
  test("renders the list of surahs", async () => {
    const { captureSpans, renderOnce, renderer } = await testRender(
      <ModeProvider><ThemeProvider>
        <SurahList />
      </ThemeProvider></ModeProvider>,
      {}
    );
    await renderOnce();

    const frame = captureSpans();
    const output = frame.lines
      .map(line => line.spans.map(s => s.text).join(""))
      .join("\n");

    // Check for some expected content
    expect(output).toContain("1. Al-Fatihah");
    expect(output).toContain("2. Al-Baqarah");
    await act(async () => {
      renderer.destroy();
    });
  });

  test("handles navigation and selection", async () => {
    let selectedId = -1;
    const handleSelect = (id: number) => {
      selectedId = id;
    };

    const { renderer, mockInput, renderOnce } = await testRender(
      <ModeProvider><ThemeProvider>
        <SurahList onSelect={handleSelect} selectedId={1} />
      </ThemeProvider></ModeProvider>,
      {}
    );
    await renderOnce();

    // Manually find and focus the select component
    const findSelect = (node: any): any => {
      // Check constructor name or properties
      if (node.constructor && node.constructor.name === "SelectRenderable") return node;
      // Fallback check
      if (node._id && node._id.startsWith("select-")) return node;
      
      if (node.getChildren) {
        for (const child of node.getChildren()) {
          const found = findSelect(child);
          if (found) return found;
        }
      }
      return null;
    };

    const foundSelect = findSelect((renderer as any).root);
    if (foundSelect) {
       foundSelect.focus();
       // Force focusable just in case
       if ('focusable' in foundSelect) foundSelect.focusable = true;
       (renderer as any).focusRenderable(foundSelect);
    }

    // Move down to second item
    await act(async () => {
      mockInput.pressArrow("down");
      await renderOnce();
    });
    
    // Press Enter to select the second item
    await act(async () => {
      mockInput.pressEnter();
      await renderOnce();
    });

    // We expect selectedId to be updated to 2 (Al-Baqarah)
    expect(selectedId).toBe(2);

    // Move up to first item
    await act(async () => {
      mockInput.pressArrow("up");
      await renderOnce();
    });

    // Press Enter
    await act(async () => {
      mockInput.pressEnter();
      await renderOnce();
    });

    expect(selectedId).toBe(1);
    await act(async () => {
      renderer.destroy();
    });
  });
});
