import { describe, expect, test } from "bun:test";
import { choiceForKey, handleDialogKey, wrapDialogLine, type DialogChoice } from "../../src/tui/components/choice-dialog.tsx";

const choices: DialogChoice[] = [
  { key: "d", label: "Download", action() {} },
  { key: "r", label: "Retry", action() {} },
];

describe("choice dialog keyboard ownership", () => {
  test("maps shortcuts case-insensitively", () => {
    expect(choiceForKey(choices, { sequence: "D" })?.label).toBe("Download");
    expect(choiceForKey(choices, { sequence: "r" })?.label).toBe("Retry");
  });

  test("Enter selects the primary action and unrelated keys are ignored", () => {
    expect(choiceForKey(choices, { name: "return" })?.label).toBe("Download");
    expect(choiceForKey(choices, { name: "enter" })?.label).toBe("Download");
    expect(choiceForKey(choices, { sequence: "q" })).toBeUndefined();
  });

  test("consumes modal input before sibling or renderable handlers can receive it", () => {
    let prevented = 0;
    let stopped = 0;
    let dismissed = 0;
    handleDialogKey(choices, {
      name: "escape",
      sequence: "\u001b",
      preventDefault: () => { prevented += 1; },
      stopPropagation: () => { stopped += 1; },
    } as never, () => { dismissed += 1; });
    expect({ prevented, stopped, dismissed }).toEqual({ prevented: 1, stopped: 1, dismissed: 1 });
  });

  test("pre-wraps disclosure text into physical terminal rows", () => {
    expect(wrapDialogLine("one two three four five", 9)).toEqual(["one two", "three", "four five"]);
  });
});
