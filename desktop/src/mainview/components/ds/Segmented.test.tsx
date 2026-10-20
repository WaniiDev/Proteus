import { describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { useDom } from "../../test/dom";
import { Segmented, type SegmentedOption } from "./Segmented";

useDom();

const OPTIONS: SegmentedOption<"system" | "light" | "dark">[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Day" },
  { value: "dark", label: "Night" },
];

type Harness = { host: HTMLElement; root: Root; picked: string[] };

async function mount(start: "system" | "light" | "dark" = "system"): Promise<Harness> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const picked: string[] = [];
  function Wrapper() {
    const [value, setValue] = useState(start);
    return <Segmented options={OPTIONS} value={value} onChange={(next) => { picked.push(next); setValue(next); }} label="Theme" />;
  }
  const root = createRoot(host);
  await act(async () => root.render(<Wrapper />));
  return { host, root, picked };
}

const tabs = (h: Harness) => Array.from(h.host.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const track = (h: Harness) => h.host.querySelector(".segmented")!;
const key = (target: Element, name: string) => act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
const unmount = (h: Harness) => act(async () => { h.root.unmount(); h.host.remove(); });

describe("Segmented", () => {
  test("renders a sliding tablist with the selected index and a roving tab stop", () => {
    const html = renderToStaticMarkup(<Segmented options={OPTIONS} value="light" onChange={() => undefined} label="Theme" />);
    expect(html).toContain('class="segmented slide seg-n-3 seg-at-1"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Theme"');
    expect(html.match(/aria-selected="true"/g)?.length).toBe(1);
    expect(html.match(/tabindex="-1"/g)?.length).toBe(2);
  });

  test("clicking a tab selects it and moves the thumb", async () => {
    const h = await mount("system");
    await act(async () => tabs(h)[2]!.click());
    expect(h.picked).toEqual(["dark"]);
    expect(track(h).className).toContain("seg-at-2");
    expect(track(h).className).toContain("seg-forward");
    await act(async () => tabs(h)[0]!.click());
    expect(track(h).className).toContain("seg-back");
    await unmount(h);
  });

  test("arrow keys move focus and select, wrapping at the ends", async () => {
    const h = await mount("system");
    tabs(h)[0]!.focus();
    await key(tabs(h)[0]!, "ArrowRight");
    expect(h.picked).toEqual(["light"]);
    expect(document.activeElement).toBe(tabs(h)[1]!);
    await key(tabs(h)[1]!, "ArrowDown");
    expect(document.activeElement).toBe(tabs(h)[2]!);
    await key(tabs(h)[2]!, "ArrowRight");
    expect(h.picked).toEqual(["light", "dark", "system"]);
    expect(document.activeElement).toBe(tabs(h)[0]!);
    await key(tabs(h)[0]!, "ArrowLeft");
    expect(document.activeElement).toBe(tabs(h)[2]!);
    await key(tabs(h)[2]!, "ArrowUp");
    expect(document.activeElement).toBe(tabs(h)[1]!);
    await unmount(h);
  });

  test("Home and End jump to the first and last tab", async () => {
    const h = await mount("light");
    tabs(h)[1]!.focus();
    await key(tabs(h)[1]!, "End");
    expect(h.picked).toEqual(["dark"]);
    expect(tabs(h)[2]!.getAttribute("aria-selected")).toBe("true");
    await key(tabs(h)[2]!, "Home");
    expect(h.picked).toEqual(["dark", "system"]);
    expect(document.activeElement).toBe(tabs(h)[0]!);
    expect(tabs(h)[0]!.tabIndex).toBe(0);
    expect(tabs(h)[2]!.tabIndex).toBe(-1);
    await unmount(h);
  });

  test("ignores unrelated keys", async () => {
    const h = await mount("system");
    await key(tabs(h)[0]!, "a");
    expect(h.picked).toEqual([]);
    await unmount(h);
  });
});
