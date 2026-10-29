import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import StreamApp from "../../src/tui/stream-app.tsx";

describe("stream reader navigation", () => {
  test("opens at the requested ayah and k steps back into the previous surah", async () => {
    const setup = await testRender(<StreamApp initialVerseKey="2:1" />, {
      width: 100,
      height: 12,
      screenMode: "split-footer",
      footerHeight: 8,
      externalOutputMode: "capture-stdout",
    });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("2. Al-Baqarah");
    expect(setup.captureCharFrame()).toContain("1/286");

    await act(async () => { setup.mockInput.pressKey("k"); await new Promise((resolve) => setTimeout(resolve, 20)); });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("1. Al-Fatihah");
    expect(setup.captureCharFrame()).toContain("7/7");
    act(() => setup.renderer.destroy());
  });
});
