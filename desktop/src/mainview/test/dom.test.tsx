import { describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useDom } from "./dom";

useDom();

describe("test DOM", () => {
  test("renders React and dispatches keyboard events", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div"); document.body.append(host);
    const keys: string[] = [];
    const root = createRoot(host);
    await act(async () => root.render(<button onKeyDown={(e) => keys.push(e.key)}>Go</button>));
    const button = host.querySelector("button")!;
    button.focus();
    await act(async () => { button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(document.activeElement).toBe(button);
    expect(keys).toEqual(["ArrowDown"]);
    await act(async () => root.unmount());
  });
});
