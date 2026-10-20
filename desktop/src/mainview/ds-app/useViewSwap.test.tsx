import { describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useDom } from "../test/dom";
import { useViewSwap, type ViewSwapOptions } from "./useViewSwap";
import { LENS_ID, LENS_WAVE_ID, installLens, lensRipple } from "./lens";
import { Lens } from "../components/Lens";

useDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function Probe({ target, options }: { target: string; options: ViewSwapOptions }) {
  const { shown, leaving } = useViewSwap(target, options);
  return <main data-leaving={String(leaving)}><section className={leaving ? "view is-leaving" : "view"}>{shown}</section></main>;
}

async function setup(options: ViewSwapOptions) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (target: string) => act(async () => root.render(<Probe target={target} options={options} />));
  const views = () => [...host.querySelectorAll("section.view")].map((el) => el.textContent);
  const leaving = () => host.querySelector("section")!.classList.contains("is-leaving");
  await render("chat");
  return { render, views, leaving, done: () => act(async () => root.unmount()) };
}

describe("useViewSwap", () => {
  test("exits the current view, then mounts the next: always exactly one view", async () => {
    const t = await setup({ exitMs: 20, reduced: () => false, viewTransition: null });
    expect(t.views()).toEqual(["chat"]);
    await t.render("memory");
    expect(t.views()).toEqual(["chat"]);
    expect(t.leaving()).toBe(true);
    await act(async () => { await sleep(40); });
    expect(t.views()).toEqual(["memory"]);
    expect(t.leaving()).toBe(false);
    await t.done();
  });

  test("the latest destination wins when navigation is rapid", async () => {
    const t = await setup({ exitMs: 20, reduced: () => false, viewTransition: null });
    await t.render("projects");
    await t.render("settings");
    expect(t.views()).toHaveLength(1);
    await act(async () => { await sleep(60); });
    expect(t.views()).toEqual(["settings"]);
    await t.done();
  });

  test("going back to the shown view cancels the exit", async () => {
    const t = await setup({ exitMs: 20, reduced: () => false, viewTransition: null });
    await t.render("projects");
    await t.render("chat");
    expect(t.leaving()).toBe(false);
    await act(async () => { await sleep(40); });
    expect(t.views()).toEqual(["chat"]);
    await t.done();
  });

  test("reduced motion swaps instantly", async () => {
    const t = await setup({ exitMs: 20, reduced: () => true });
    await t.render("memory");
    expect(t.views()).toEqual(["memory"]);
    expect(t.leaving()).toBe(false);
    await t.done();
  });

  test("uses the View Transitions API when given one", async () => {
    let calls = 0;
    const t = await setup({ reduced: () => false, viewTransition: (update) => { calls++; queueMicrotask(update); } });
    await t.render("settings");
    await act(async () => { await sleep(0); });
    expect(calls).toBe(1);
    expect(t.views()).toEqual(["settings"]);
    expect(t.leaving()).toBe(false);
    await t.done();
  });
});

describe("lens", () => {
  test("<Lens/> renders the filter and its ripple animation once; installLens does not duplicate it", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Lens />));
    expect(document.querySelectorAll(`#${LENS_ID}`)).toHaveLength(1);
    expect(document.getElementById(LENS_WAVE_ID)?.getAttribute("dur")).toBe("0.7s");
    installLens();
    expect(document.querySelectorAll(`#${LENS_ID}`)).toHaveLength(1);
    await act(async () => root.unmount());
  });

  test("lensRipple begins the wave, and is a no-op under reduced motion", () => {
    document.body.innerHTML = "";
    installLens();
    let begun = 0;
    (document.getElementById(LENS_WAVE_ID) as unknown as { beginElement: () => void }).beginElement = () => { begun++; };
    lensRipple();
    expect(begun).toBe(1);
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q })) as typeof window.matchMedia;
    lensRipple();
    window.matchMedia = original;
    expect(begun).toBe(1);
  });
});

describe("useViewSwap immediate moves", () => {
  test("a move the caller marks immediate skips the exit beat", async () => {
    const t = await setup({ exitMs: 200, reduced: () => false, viewTransition: null, immediate: (from) => from === "chat" });
    await t.render("memory");
    expect(t.views()).toEqual(["memory"]);
    expect(t.leaving()).toBe(false);
    await t.done();
  });
});
