import { useEffect } from "react";

/** Quiet period after the last scroll event before the thumb starts to fade. */
export const SCROLLBAR_IDLE_MS = 700;
/** Length of the "fading" step before data-scrollbar is removed. */
export const SCROLLBAR_FADE_MS = 180;

export interface ScrollbarTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: ScrollbarTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Port of Proteus.scrollbars (design system bundle.js). Chromium does not repaint ::-webkit-scrollbar parts when a
 * scroller's :hover changes, so the active scroll areas are marked data-scrollbar="on", then "fading", then unmarked.
 * Returns a cleanup that removes the listeners, pending timers and any attributes it set.
 */
export function installScrollbars(doc: Document, timers: ScrollbarTimers = realTimers): () => void {
  let hovered: Element[] = [];
  const scrolling = new Map<Element, unknown>();
  const fades = new Map<Element, unknown>();
  const win = doc.defaultView;

  const scrollable = (el: Element): boolean => {
    const cs = (win ?? globalThis).getComputedStyle(el);
    return (
      (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) ||
      (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1)
    );
  };
  const chain = (target: EventTarget | null): Element[] => {
    const out: Element[] = [];
    for (let node = target as Element | null; node && node.nodeType === 1; node = node.parentElement) {
      if (scrollable(node)) out.push(node);
    }
    return out;
  };
  const wanted = (el: Element): boolean => {
    const focus = doc.activeElement;
    return hovered.includes(el) || scrolling.has(el) || (!!focus && focus !== doc.body && el.contains(focus) && chain(focus).includes(el));
  };
  const show = (el: Element): void => {
    timers.clearTimeout(fades.get(el));
    fades.delete(el);
    if (el.getAttribute("data-scrollbar") !== "on") el.setAttribute("data-scrollbar", "on");
  };
  const settle = (el: Element): void => {
    if (wanted(el) || el.getAttribute("data-scrollbar") !== "on") return;
    el.setAttribute("data-scrollbar", "fading");
    fades.set(
      el,
      timers.setTimeout(() => {
        fades.delete(el);
        if (wanted(el)) show(el);
        else el.removeAttribute("data-scrollbar");
      }, SCROLLBAR_FADE_MS),
    );
  };
  const hover = (list: Element[]): void => {
    const old = hovered;
    hovered = list;
    list.forEach(show);
    old.forEach(settle);
  };

  const onOver = (e: Event) => hover(chain(e.target));
  const onOut = (e: Event) => {
    if (!(e as PointerEvent).relatedTarget) hover([]);
  };
  const onScroll = (e: Event) => {
    const el = e.target === doc ? doc.scrollingElement : (e.target as Element | null);
    if (!el || el.nodeType !== 1) return;
    show(el);
    timers.clearTimeout(scrolling.get(el));
    scrolling.set(
      el,
      timers.setTimeout(() => {
        scrolling.delete(el);
        settle(el);
      }, SCROLLBAR_IDLE_MS),
    );
  };
  const onFocusIn = (e: Event) => chain(e.target).forEach(show);
  const focusOutTimers = new Set<unknown>();
  const onFocusOut = (e: Event) => {
    const from = chain(e.target);
    const handle = timers.setTimeout(() => {
      focusOutTimers.delete(handle);
      from.forEach(settle);
    }, 0);
    focusOutTimers.add(handle);
  };

  doc.addEventListener("pointerover", onOver, true);
  doc.addEventListener("pointerout", onOut, true);
  doc.addEventListener("scroll", onScroll, true);
  doc.addEventListener("focusin", onFocusIn, true);
  doc.addEventListener("focusout", onFocusOut, true);

  return () => {
    doc.removeEventListener("pointerover", onOver, true);
    doc.removeEventListener("pointerout", onOut, true);
    doc.removeEventListener("scroll", onScroll, true);
    doc.removeEventListener("focusin", onFocusIn, true);
    doc.removeEventListener("focusout", onFocusOut, true);
    for (const handle of [...scrolling.values(), ...fades.values(), ...focusOutTimers]) timers.clearTimeout(handle);
    for (const el of new Set([...scrolling.keys(), ...fades.keys(), ...hovered])) el.removeAttribute("data-scrollbar");
    scrolling.clear();
    fades.clear();
    hovered = [];
  };
}

/** Install the custom scrollbar wake/sleep behaviour once, at the app root. */
export function useScrollbars(): void {
  useEffect(() => installScrollbars(document), []);
}
