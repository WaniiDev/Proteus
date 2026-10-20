import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { surge } from "./surge";

type Call = { keyframes: unknown[]; options: { duration: number; delay?: number } };
function fake(rect = { left: 0, top: 0, width: 100, height: 100 }) {
  const calls: Call[] = [];
  const el: any = {
    style: { setProperty() {} },
    getBoundingClientRect: () => rect,
    animate: (keyframes: unknown[], options: Call["options"]) => void calls.push({ keyframes, options }),
    querySelector: () => el,
    querySelectorAll: () => [el, el],
  };
  return { el, calls };
}

describe("surge", () => {
  // The lens ripple is scheduled for the half-way point; keep it from firing in other test files.
  const realSetTimeout = globalThis.setTimeout;
  const scheduled: number[] = [];
  beforeEach(() => {
    (globalThis as any).setTimeout = (_fn: unknown, ms: number) => void scheduled.push(ms);
  });
  afterEach(() => {
    globalThis.setTimeout = realSetTimeout;
  });

  it("animates focus, glow, two rings and the stage over 2.2s", () => {
    const layer = fake();
    const stage = fake();
    expect(surge(layer.el, fake().el, { stage: stage.el })).toBe(true);
    expect(layer.calls).toHaveLength(4);
    expect(layer.calls.slice(2).map((c) => c.options.delay)).toEqual([1100, 1240]);
    expect(stage.calls).toHaveLength(1);
    expect(stage.calls[0].options.duration).toBe(2200);
    expect(scheduled).toEqual([1100]);
  });

  it("does nothing without a layer or origin", () => {
    expect(surge(null, fake().el)).toBe(false);
    expect(surge(fake().el, null)).toBe(false);
  });

  it("does nothing under reduced motion", () => {
    const original = globalThis.window;
    (globalThis as any).window = { matchMedia: () => ({ matches: true }) };
    try {
      const layer = fake();
      expect(surge(layer.el, fake().el)).toBe(false);
      expect(layer.calls).toHaveLength(0);
    } finally {
      (globalThis as any).window = original;
    }
  });
});
