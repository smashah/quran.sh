import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import ImmersiveApp from "../../src/tui/immersive-app.tsx";
import { FeatureRuntimeProvider, type AnyRuntime } from "../../src/features/react.tsx";
import { createFeatureRuntime } from "../../src/features/runtime.ts";
import type { StudyService } from "../../src/features/study/service.ts";

function emptyStudyService(): StudyService {
  return {
    inspect: async (verseKey) => ({
      verseKey,
      translation: [],
      tafsir: [],
      words: [],
      topics: [],
      crossReferences: [],
      mushaf: [],
      recitation: [],
    }),
    recitation: async () => [],
    search: async () => [],
    licenses: () => [],
    dispose() {},
  };
}

describe("immersive confirmation flow", () => {
  test("play with no pack opens a modal and Escape returns to an unchanged Quran reader", async () => {
    const runtime = createFeatureRuntime({
      study: { load: async () => ({ value: emptyStudyService(), dispose() {} }) },
      recitation: { load: async () => ({ value: {}, dispose() {} }) },
      recognition: { load: async () => ({ value: {}, dispose() {} }) },
      "spatial-backdrop": { load: async () => ({ value: {}, dispose() {} }) },
    }) as AnyRuntime;
    const setup = await testRender(
      <FeatureRuntimeProvider runtime={runtime}><ImmersiveApp /></FeatureRuntimeProvider>,
      { width: 100, height: 30 },
    );
    await setup.renderOnce();
    const initial = setup.captureCharFrame();
    expect(initial).toContain("Al-Fatihah");

    await act(async () => {
      setup.mockInput.pressKey("p");
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    await setup.renderOnce();
    const modal = setup.captureCharFrame();
    expect(modal).toContain("Download a recitation pack?");
    expect(modal).toContain("[D] Download pack");
    expect(modal).toContain("Al-Fatihah");

    await act(async () => { setup.mockInput.pressKey("p"); });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Download a recitation pack?");

    await act(async () => { setup.mockInput.pressEscape(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    await setup.renderOnce();
    const dismissed = setup.captureCharFrame();
    expect(dismissed).not.toContain("Download a recitation pack?");
    expect(dismissed).toContain("Al-Fatihah");
    expect(dismissed).toContain("In the name of Allah");

    act(() => setup.renderer.destroy());
    await runtime.shutdown();
  });
});
