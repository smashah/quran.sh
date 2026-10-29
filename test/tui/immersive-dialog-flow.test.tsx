import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import ImmersiveApp from "../../src/tui/immersive-app.tsx";
import { FeatureRuntimeProvider, type AnyRuntime } from "../../src/features/react.tsx";
import { createFeatureRuntime } from "../../src/features/runtime.ts";
import type { StudyService } from "../../src/features/study/service.ts";
import { resetOnlineSourceSession } from "../../src/features/network/online-source-consent.ts";

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

function emptyRuntime(): AnyRuntime {
  return createFeatureRuntime({
    study: { load: async () => ({ value: emptyStudyService(), dispose() {} }) },
    recitation: { load: async () => ({ value: {}, dispose() {} }) },
    recognition: { load: async () => ({ value: {}, dispose() {} }) },
    "spatial-backdrop": { load: async () => ({ value: {}, dispose() {} }) },
  }) as AnyRuntime;
}

// Keep the flow hermetic: the public Quran.com timing source is "unavailable",
// so accepted playback falls through to the offline pack offer.
const realFetch = globalThis.fetch;
beforeEach(() => {
  resetOnlineSourceSession();
  globalThis.fetch = (async () => { throw new Error("network disabled in tests"); }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("immersive confirmation flow", () => {
  test("Continue offline keeps the reader open and online features ask before connecting", async () => {
    const runtime = emptyRuntime();
    const setup = await testRender(
      <FeatureRuntimeProvider runtime={runtime}><ImmersiveApp initialVerseKey="1:1" /></FeatureRuntimeProvider>,
      { width: 100, height: 30 },
    );
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("[C] Continue offline");

    await act(async () => { setup.mockInput.pressEscape(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    await setup.renderOnce();
    const offline = setup.captureCharFrame();
    expect(offline).not.toContain("Online sources for immersive mode");
    expect(offline).toContain("In the name of Allah");
    expect(offline).toContain("OFFLINE");

    await act(async () => { setup.mockInput.pressKey("w"); await new Promise((resolve) => setTimeout(resolve, 20)); });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Go online for tafsir and study?");

    await act(async () => { setup.mockInput.pressKey("c"); await new Promise((resolve) => setTimeout(resolve, 20)); });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).not.toContain("Go online for tafsir and study?");

    await act(async () => { setup.mockInput.pressKey("?"); await new Promise((resolve) => setTimeout(resolve, 20)); });
    await setup.renderOnce();
    const help = setup.captureCharFrame();
    expect(help).toContain("Immersive reader keys");
    expect(help).toContain("Memorise");

    await act(async () => { setup.mockInput.pressEscape(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).not.toContain("Immersive reader keys");

    act(() => setup.renderer.destroy());
    await runtime.shutdown();
  });

  test("Memorise hides the next ayah until Space reveals it", async () => {
    const runtime = emptyRuntime();
    const setup = await testRender(
      <FeatureRuntimeProvider runtime={runtime}><ImmersiveApp initialVerseKey="1:1" /></FeatureRuntimeProvider>,
      { width: 100, height: 30 },
    );
    await setup.renderOnce();
    await act(async () => { setup.mockInput.pressEscape(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    await act(async () => { setup.mockInput.pressKey("4"); await new Promise((resolve) => setTimeout(resolve, 20)); });
    await setup.renderOnce();
    const hidden = setup.captureCharFrame();
    expect(hidden).toContain("Memorise view");
    expect(hidden).toContain("NEXT · 1:2");
    expect(hidden).toContain("Space reveals it");

    await act(async () => { setup.mockInput.pressKey(" "); await new Promise((resolve) => setTimeout(resolve, 20)); });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).not.toContain("Space reveals it");

    act(() => setup.renderer.destroy());
    await runtime.shutdown();
  });

  test("accepted immersive sources lead to the pack modal and Escape returns to the Quran reader", async () => {
    const runtime = createFeatureRuntime({
      study: { load: async () => ({ value: emptyStudyService(), dispose() {} }) },
      recitation: { load: async () => ({ value: {}, dispose() {} }) },
      recognition: { load: async () => ({ value: {}, dispose() {} }) },
      "spatial-backdrop": { load: async () => ({ value: {}, dispose() {} }) },
    }) as AnyRuntime;
    const setup = await testRender(
      <FeatureRuntimeProvider runtime={runtime}><ImmersiveApp initialVerseKey="1:1" /></FeatureRuntimeProvider>,
      { width: 100, height: 30 },
    );
    await setup.renderOnce();
    const initial = setup.captureCharFrame();
    expect(initial).toContain("Al-Fatihah");
    expect(initial).toContain("Online sources for immersive mode");

    await act(async () => {
      setup.mockInput.pressEnter();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await setup.renderOnce();

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
