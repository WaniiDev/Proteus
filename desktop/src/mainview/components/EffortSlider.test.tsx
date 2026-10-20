import { describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { useDom } from "../test/dom";
import type { ReasoningEffort } from "../../shared/contracts";
import { EffortSlider } from "./EffortSlider";

const render = (levels: ReasoningEffort[] | undefined, value: ReasoningEffort | null, extra: { compact?: boolean; model?: string } = {}) =>
  renderToStaticMarkup(<EffortSlider model={extra.model ?? "Sonnet 5.5"} levels={levels} value={value} onChange={() => {}} compact={extra.compact} />);

useDom();

describe("EffortSlider", () => {
  test("2-level model", () => {
    const html = render(["none", "high"], "none");
    expect(html).toContain('class="effort eff-n-2 eff-at-0"');
    expect(html).toContain('max="1"');
    expect(html).toContain("effort-tick t-0 on");
    expect(html).toContain('effort-tick t-1"');
    expect(html).not.toContain("is-max");
    expect(html).toContain("Answers right away, without thinking first.");
  });

  test("8-level model at the top is the max moment", () => {
    const html = render(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"], "ultra");
    expect(html).toContain("eff-n-8 eff-at-7 is-max");
    expect(html).toContain('max="7"');
    expect(html).toContain("effort-tick t-7 on");
    expect(html).toContain('aria-valuetext="Ultra, the most this model can think"');
    expect(html).toContain("<span>Ultra</span>");
  });

  test("top level is whichever value the model tops out at", () => {
    const html = render(["low", "medium", "high"], "high");
    expect(html).toContain("eff-n-3 eff-at-2 is-max");
    expect(html).toContain('aria-valuetext="High, the most this model can think"');
  });

  test("accessibility and native range attributes", () => {
    const html = render(["none", "low", "medium", "high", "max"], "medium", { model: "Opus 5.5" });
    expect(html).toContain('type="range"');
    expect(html).toContain('min="0"');
    expect(html).toContain('step="1"');
    expect(html).toContain('value="2"');
    expect(html).toContain('aria-label="Thinking for Opus 5.5"');
    expect(html).toContain('aria-valuetext="Medium"');
  });

  test("keeps the nearest level when the value is not offered", () => {
    const html = render(["low", "medium", "high", "xhigh", "max"], "none");
    expect(html).toContain("eff-at-0");
    expect(html).toContain('aria-valuetext="Low"');
  });

  test("no options shows the message and no slider", () => {
    for (const levels of [undefined, []] as const) {
      const html = render(levels as ReasoningEffort[] | undefined, "high");
      expect(html).toContain("This model doesn’t offer adjustable thinking.");
      expect(html).not.toContain("<input");
    }
  });

  test("compact omits the description line", () => {
    const html = render(["low", "medium"], "low", { compact: true });
    expect(html).not.toContain("picker-hint");
    expect(html).toContain("effort-value");
  });

  test("long model names stay in the label", () => {
    const name = "A very long model name ".repeat(8).trim();
    expect(render(["low", "high"], "low", { model: name })).toContain(`aria-label="Thinking for ${name}"`);
  });
});

describe("EffortSlider keyboard and callbacks", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const LEVELS: ReasoningEffort[] = ["none", "low", "medium", "high", "max"];

  async function mount(start: ReasoningEffort, levels: ReasoningEffort[] = LEVELS) {
    const changes: ReasoningEffort[] = [];
    let tops = 0;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const Harness = () => {
      const [value, setValue] = useState<ReasoningEffort>(start);
      return <EffortSlider model="M" levels={levels} value={value} onChange={(l) => { changes.push(l); setValue(l); }} onTopLevel={() => void tops++} />;
    };
    await act(async () => root.render(<Harness />));
    const input = () => host.querySelector("input")!;
    // happy-dom lacks native oninput support, so React's change polyfill needs the field focused first.
    await act(async () => input().focus());
    const press = async (key: string) => {
      await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
    };
    const drag = async (to: number) => {
      await act(async () => {
        const el = input();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, String(to));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        // React falls back to key events for value changes when the DOM lacks oninput (happy-dom).
        el.dispatchEvent(new KeyboardEvent("keyup", { key: "Unidentified", bubbles: true }));
      });
    };
    return { host, root, changes, tops: () => tops, input, press, drag, text: () => host.querySelector(".effort-value")!.textContent };
  }

  test("arrow keys step one level", async () => {
    const t = await mount("medium");
    await t.press("ArrowRight");
    await t.press("ArrowUp");
    expect(t.changes).toEqual(["high", "max"]);
    await t.press("ArrowLeft");
    await t.press("ArrowDown");
    expect(t.changes).toEqual(["high", "max", "high", "medium"]);
    expect(t.text()).toBe("Medium");
    await act(async () => t.root.unmount());
  });

  test("Home and End jump to the ends", async () => {
    const t = await mount("medium");
    await t.press("End");
    await t.press("Home");
    expect(t.changes).toEqual(["max", "none"]);
    expect(t.input().value).toBe("0");
    await act(async () => t.root.unmount());
  });

  test("keys at an end do nothing, other keys are ignored", async () => {
    const t = await mount("none");
    await t.press("ArrowLeft");
    await t.press("Home");
    await t.press("a");
    expect(t.changes).toEqual([]);
    await act(async () => t.root.unmount());
  });

  test("a range input event reports the chosen effort", async () => {
    const t = await mount("none");
    await t.drag(3);
    expect(t.changes).toEqual(["high"]);
    expect(t.input().getAttribute("aria-valuetext")).toBe("High");
    await act(async () => t.root.unmount());
  });

  test("onTopLevel fires once per arrival, not on mount or re-render", async () => {
    const t = await mount("max");
    expect(t.tops()).toBe(0);
    await act(async () => t.root.render(<EffortSlider model="M" levels={LEVELS} value="max" onChange={() => {}} onTopLevel={() => {}} />));
    expect(t.tops()).toBe(0);
    await act(async () => t.root.unmount());

    const u = await mount("high");
    await u.press("ArrowRight");
    expect(u.tops()).toBe(1);
    await u.press("ArrowRight");
    expect(u.tops()).toBe(1);
    await u.press("ArrowLeft");
    expect(u.tops()).toBe(1);
    await u.press("End");
    expect(u.tops()).toBe(2);
    await act(async () => u.root.unmount());
  });
});
