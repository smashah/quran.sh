import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import App from "../../src/tui/app";
import { FeatureRuntimeProvider, type AnyRuntime } from "../../src/features/react.tsx";
import { createFeatureRuntime } from "../../src/features/runtime.ts";

describe("TUI Layout", () => {
  test("renders 2-panel layout with Sidebar and Main Content", async () => {
    const runtime = createFeatureRuntime({}) as AnyRuntime;
    const { captureCharFrame, mockInput, renderOnce, renderer } = await testRender(
      <FeatureRuntimeProvider runtime={runtime}><App /></FeatureRuntimeProvider>,
      {},
    );
    await renderOnce();

    expect(captureCharFrame()).toContain("Arabic Rendering Calibration");

    await act(async () => {
      mockInput.pressEnter();
      await renderOnce();
    });
    // OpenTUI 0.6+ commits the state change on the following frame.
    await act(async () => {
      await renderOnce();
    });

    const output = captureCharFrame();

    expect(output).toContain("Surahs");
    expect(output).toContain("Reading");
    expect(output).toContain("Tracking: OFF");
    await act(async () => {
      renderer.destroy();
    });
    await runtime.shutdown();
  });
});
