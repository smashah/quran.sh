import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import App from "../../src/tui/app";

describe("TUI Layout", () => {
  test("renders 2-panel layout with Sidebar and Main Content", async () => {
    const { captureCharFrame, mockInput, renderOnce, renderer } = await testRender(<App />, {});
    await renderOnce();

    expect(captureCharFrame()).toContain("Arabic Rendering Calibration");

    await act(async () => {
      mockInput.pressEnter();
      await renderOnce();
    });

    const output = captureCharFrame();

    expect(output).toContain("Surahs");
    expect(output).toContain("Reading");
    await act(async () => {
      renderer.destroy();
    });
  });
});
