import { describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useDom } from "../../test/dom";
import { Select, type SelectOption } from "./Select";

useDom();

const OPTIONS: SelectOption<"a" | "b" | "c">[] = [
  { value: "a", name: "Alpha", how: "API key", status: { text: "Connected", dot: "ok" }, mark: (small) => <i data-mark={small ? "small" : "full"} /> },
  { value: "b", name: "Beta", how: "Account", status: { text: "Not connected" } },
  { value: "c", name: "Gamma", how: "API key", status: { text: "Checking…", dot: "run" } },
];

type Harness = { host: HTMLElement; root: Root; picked: string[] };

async function mount(start: "a" | "b" | "c" = "a", disabled = false): Promise<Harness> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const picked: string[] = [];
  function Wrapper() {
    const [value, setValue] = useState(start);
    return <Select options={OPTIONS} value={value} onChange={(next) => { picked.push(next); setValue(next); }} label="Providers" triggerLabel={(o) => `Provider: ${o.name}`} disabled={disabled} />;
  }
  const root = createRoot(host);
  await act(async () => root.render(<Wrapper />));
  return { host, root, picked };
}

const trigger = (h: Harness) => h.host.querySelector<HTMLButtonElement>(".select-trigger")!;
const options = (h: Harness) => Array.from(h.host.querySelectorAll<HTMLElement>('[role="option"]'));
const key = (target: Element, name: string) => act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const unmount = (h: Harness) => act(async () => { h.root.unmount(); h.host.remove(); });

describe("Select", () => {
  test("shows the choice with its mark, name, how it connects and status; the list is closed", async () => {
    const h = await mount();
    const t = trigger(h);
    expect(t.getAttribute("aria-haspopup")).toBe("listbox");
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(t.getAttribute("aria-label")).toBe("Provider: Alpha");
    expect(t.textContent).toContain("Alpha");
    expect(t.textContent).toContain("API key");
    expect(t.textContent).toContain("Connected");
    expect(t.querySelector('[data-mark="full"]')).not.toBeNull();
    expect(h.host.querySelector('[role="listbox"]')).toBeNull();
    await unmount(h);
  });

  test("ArrowDown on the trigger opens the list with focus on the chosen option", async () => {
    const h = await mount("b");
    trigger(h).focus();
    await key(trigger(h), "ArrowDown");
    expect(trigger(h).getAttribute("aria-expanded")).toBe("true");
    const list = h.host.querySelector('[role="listbox"]')!;
    expect(list.getAttribute("aria-label")).toBe("Providers");
    expect(options(h).map((o) => o.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(document.activeElement).toBe(options(h)[1]!);
    await unmount(h);
  });

  test("ArrowUp on the trigger also opens on the chosen option", async () => {
    const h = await mount("c");
    trigger(h).focus();
    await key(trigger(h), "ArrowUp");
    expect(document.activeElement).toBe(options(h)[2]!);
    await unmount(h);
  });

  test("every option shows its own state and how it connects", async () => {
    const h = await mount();
    await key(trigger(h), "ArrowDown");
    const text = options(h).map((o) => o.textContent);
    expect(text[0]).toContain("Connected · API key");
    expect(text[1]).toContain("Not connected · Account");
    expect(text[2]).toContain("Checking… · API key");
    expect(options(h)[0]!.querySelector('[data-mark="small"]')).not.toBeNull();
    expect(options(h)[2]!.querySelector(".dot.run")).not.toBeNull();
    await unmount(h);
  });

  test("Up, Down, Home and End move through the options and wrap", async () => {
    const h = await mount("a");
    await key(trigger(h), "ArrowDown");
    const list = h.host.querySelector('[role="listbox"]')!;
    await key(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(options(h)[1]!);
    await key(document.activeElement!, "End");
    expect(document.activeElement).toBe(options(h)[2]!);
    await key(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(options(h)[0]!);
    await key(document.activeElement!, "ArrowUp");
    expect(document.activeElement).toBe(options(h)[2]!);
    await key(document.activeElement!, "Home");
    expect(document.activeElement).toBe(options(h)[0]!);
    expect(list.isConnected).toBe(true);
    expect(h.picked).toEqual([]);
    await unmount(h);
  });

  test("Enter picks the focused option, closes and returns focus to the trigger", async () => {
    const h = await mount("a");
    await key(trigger(h), "ArrowDown");
    await key(document.activeElement!, "ArrowDown");
    await key(document.activeElement!, "Enter");
    expect(h.picked).toEqual(["b"]);
    expect(trigger(h).getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger(h));
    expect(trigger(h).textContent).toContain("Beta");
    await wait(220);
    expect(h.host.querySelector('[role="listbox"]')).toBeNull();
    await unmount(h);
  });

  test("Space picks the focused option", async () => {
    const h = await mount("a");
    await key(trigger(h), "ArrowDown");
    await key(document.activeElement!, "End");
    await key(document.activeElement!, " ");
    expect(h.picked).toEqual(["c"]);
    expect(document.activeElement).toBe(trigger(h));
    await unmount(h);
  });

  test("Escape closes without picking and returns focus to the trigger", async () => {
    const h = await mount("a");
    await key(trigger(h), "ArrowDown");
    await key(document.activeElement!, "ArrowDown");
    await key(document.activeElement!, "Escape");
    expect(h.picked).toEqual([]);
    expect(trigger(h).getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger(h));
    await wait(220);
    expect(h.host.querySelector('[role="listbox"]')).toBeNull();
    await unmount(h);
  });

  test("clicking the trigger toggles, and clicking an option picks it", async () => {
    const h = await mount("a");
    await act(async () => trigger(h).click());
    expect(trigger(h).getAttribute("aria-expanded")).toBe("true");
    await act(async () => options(h)[2]!.click());
    expect(h.picked).toEqual(["c"]);
    expect(trigger(h).getAttribute("aria-expanded")).toBe("false");
    await unmount(h);
  });

  test("picking the current option closes without calling onChange", async () => {
    const h = await mount("a");
    await key(trigger(h), "ArrowDown");
    await key(document.activeElement!, "Enter");
    expect(h.picked).toEqual([]);
    expect(trigger(h).getAttribute("aria-expanded")).toBe("false");
    await unmount(h);
  });

  test("a press outside closes the list", async () => {
    const h = await mount("a");
    await key(trigger(h), "ArrowDown");
    await act(async () => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(trigger(h).getAttribute("aria-expanded")).toBe("false");
    await unmount(h);
  });

  test("a disabled select does not open", async () => {
    const h = await mount("a", true);
    expect(trigger(h).disabled).toBe(true);
    await key(trigger(h), "ArrowDown");
    expect(h.host.querySelector('[role="listbox"]')).toBeNull();
    await unmount(h);
  });
});
