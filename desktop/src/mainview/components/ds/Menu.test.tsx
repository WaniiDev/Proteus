import { describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { useDom } from "../../test/dom";
import { Menu, MenuItem, MenuRule } from "./Menu";

useDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

function Harness({ log }: { log: string[] }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return <>
    <button id="t" onClick={(event) => setAnchor(event.currentTarget)}>More</button>
    {anchor && <Menu label="Actions" anchor={anchor} onClose={() => setAnchor(null)}>
      <MenuItem onSelect={() => log.push("a")}>A</MenuItem>
      <MenuItem disabled reason="Not now" onSelect={() => log.push("b")}>B</MenuItem>
      <MenuRule />
      <MenuItem danger onSelect={() => log.push("c")}>C</MenuItem>
    </Menu>}
  </>;
}

async function open(log: string[]) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Harness log={log} />));
  const trigger = host.querySelector<HTMLButtonElement>("#t")!;
  trigger.focus();
  await act(async () => trigger.click());
  return { trigger, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const key = (k: string) => act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });

describe("Menu", () => {
  test("is a labelled menu with a rule and a danger item, first item focused", async () => {
    const { close } = await open([]);
    const menu = document.querySelector(".menu")!;
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.getAttribute("aria-label")).toBe("Actions");
    expect(menu.querySelector("hr")).not.toBeNull();
    expect(menu.querySelector("button.danger")?.textContent).toBe("C");
    expect(document.activeElement?.textContent).toBe("A");
    await close();
  });

  test("arrow keys skip disabled items and wrap", async () => {
    const { close } = await open([]);
    await key("ArrowDown");
    expect(document.activeElement?.textContent).toBe("C");
    await key("ArrowDown");
    expect(document.activeElement?.textContent).toBe("A");
    await key("End");
    expect(document.activeElement?.textContent).toBe("C");
    await close();
  });

  test("shows the reason on a disabled item", async () => {
    const { close } = await open([]);
    expect(document.querySelector(".menu button:disabled")?.textContent).toContain("Not now");
    await close();
  });

  test("Escape plays is-leaving, closes and restores focus to the trigger", async () => {
    const { trigger, close } = await open([]);
    await key("Escape");
    expect(document.querySelector(".menu")!.classList.contains("is-leaving")).toBe(true);
    await wait(220);
    expect(document.querySelector(".menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await close();
  });

  test("an outside press closes it; choosing runs the action once", async () => {
    const log: string[] = [];
    const { close } = await open(log);
    await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    await wait(220);
    expect(document.querySelector(".menu")).toBeNull();
    await act(async () => document.querySelector<HTMLButtonElement>("#t")!.click());
    await act(async () => document.querySelector<HTMLButtonElement>(".menu button")!.click());
    await act(async () => document.querySelector<HTMLButtonElement>(".menu button")?.click());
    await wait(220);
    expect(log).toEqual(["a"]);
    await close();
  });
});
