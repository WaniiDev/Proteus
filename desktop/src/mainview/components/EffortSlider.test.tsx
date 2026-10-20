import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReasoningEffort } from "../../shared/contracts";
import { EffortSlider } from "./EffortSlider";

const render = (levels: ReasoningEffort[] | undefined, value: ReasoningEffort | null, extra: { compact?: boolean; model?: string } = {}) =>
  renderToStaticMarkup(<EffortSlider model={extra.model ?? "Sonnet 5.5"} levels={levels} value={value} onChange={() => {}} compact={extra.compact} />);

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
