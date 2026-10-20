import { describe, expect, it } from "bun:test";
import { installScrollbars, SCROLLBAR_FADE_MS, SCROLLBAR_IDLE_MS, type ScrollbarTimers } from "./useScrollbars";

class FakeTimers implements ScrollbarTimers {
  now = 0;
  private next = 1;
  private pending = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++;
    this.pending.set(id, { at: this.now + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown) {
    this.pending.delete(handle as number);
  }
  advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
    }
    this.now = end;
  }
}

class FakeEl {
  nodeType = 1;
  attrs = new Map<string, string>();
  parentElement: FakeEl | null = null;
  scrollHeight = 500;
  clientHeight = 100;
  scrollWidth = 100;
  clientWidth = 100;
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  removeAttribute(name: string) { this.attrs.delete(name); }
  contains(other: FakeEl | null): boolean {
    for (let n = other; n; n = n.parentElement) if (n === this) return true;
    return false;
  }
}

class FakeDoc {
  nodeType = 9;
  defaultView = null;
  activeElement: FakeEl | null = null;
  body = new FakeEl();
  scrollingElement: FakeEl | null = null;
  listeners = new Map<string, Set<(e: Event) => void>>();
  addEventListener(type: string, fn: (e: Event) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: Event) => void) { this.listeners.get(type)?.delete(fn); }
  fire(type: string, event: Record<string, unknown>) {
    for (const fn of this.listeners.get(type) ?? []) fn(event as unknown as Event);
  }
}

function setup() {
  (globalThis as { getComputedStyle?: unknown }).getComputedStyle = () => ({ overflowY: "auto", overflowX: "visible" });
  const doc = new FakeDoc();
  const timers = new FakeTimers();
  const el = new FakeEl();
  const dispose = installScrollbars(doc as unknown as Document, timers);
  return { doc, timers, el, dispose };
}

describe("installScrollbars", () => {
  it("goes on while scrolling, fading after 700ms idle, then is removed 180ms later", () => {
    const { doc, timers, el } = setup();
    doc.fire("scroll", { target: el });
    expect(el.getAttribute("data-scrollbar")).toBe("on");
    timers.advance(SCROLLBAR_IDLE_MS - 1);
    expect(el.getAttribute("data-scrollbar")).toBe("on");
    timers.advance(1);
    expect(el.getAttribute("data-scrollbar")).toBe("fading");
    timers.advance(SCROLLBAR_FADE_MS - 1);
    expect(el.getAttribute("data-scrollbar")).toBe("fading");
    timers.advance(1);
    expect(el.getAttribute("data-scrollbar")).toBeNull();
  });

  it("restarts the idle timer on every scroll event", () => {
    const { doc, timers, el } = setup();
    doc.fire("scroll", { target: el });
    timers.advance(600);
    doc.fire("scroll", { target: el });
    timers.advance(600);
    expect(el.getAttribute("data-scrollbar")).toBe("on");
    timers.advance(100);
    expect(el.getAttribute("data-scrollbar")).toBe("fading");
  });

  it("stays on while hovered and fades once the pointer leaves", () => {
    const { doc, timers, el } = setup();
    doc.fire("pointerover", { target: el });
    expect(el.getAttribute("data-scrollbar")).toBe("on");
    doc.fire("scroll", { target: el });
    timers.advance(SCROLLBAR_IDLE_MS + SCROLLBAR_FADE_MS);
    expect(el.getAttribute("data-scrollbar")).toBe("on");
    doc.fire("pointerout", { target: el, relatedTarget: null });
    expect(el.getAttribute("data-scrollbar")).toBe("fading");
    timers.advance(SCROLLBAR_FADE_MS);
    expect(el.getAttribute("data-scrollbar")).toBeNull();
  });

  it("returns to on when woken during the fade", () => {
    const { doc, timers, el } = setup();
    doc.fire("scroll", { target: el });
    timers.advance(SCROLLBAR_IDLE_MS);
    expect(el.getAttribute("data-scrollbar")).toBe("fading");
    doc.fire("focusin", { target: el });
    expect(el.getAttribute("data-scrollbar")).toBe("on");
    timers.advance(SCROLLBAR_FADE_MS * 2);
    expect(el.getAttribute("data-scrollbar")).toBe("on");
  });

  it("ignores elements that do not overflow", () => {
    const { doc, el } = setup();
    el.scrollHeight = 100;
    doc.fire("pointerover", { target: el });
    expect(el.getAttribute("data-scrollbar")).toBeNull();
  });

  it("cleanup removes listeners, timers and attributes", () => {
    const { doc, timers, el, dispose } = setup();
    doc.fire("scroll", { target: el });
    dispose();
    expect(el.getAttribute("data-scrollbar")).toBeNull();
    doc.fire("scroll", { target: el });
    expect(el.getAttribute("data-scrollbar")).toBeNull();
    timers.advance(2000);
    expect(el.getAttribute("data-scrollbar")).toBeNull();
  });
});
