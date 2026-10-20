import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { reducedMotion } from "./lens";

export interface ViewSwapOptions {
  /** Length of the exit beat. Defaults to the --dur-exit token. */
  exitMs?: number;
  reduced?: () => boolean;
  /** document.startViewTransition when the webview has it; pass null to force the two-beat classes. */
  viewTransition?: ((update: () => void) => unknown) | null;
}

const FALLBACK_EXIT_MS = 160;

function tokenExitMs(): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--dur-exit").trim();
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) return FALLBACK_EXIT_MS;
    return raw.endsWith("ms") ? value : raw.endsWith("s") ? value * 1000 : FALLBACK_EXIT_MS;
  } catch {
    return FALLBACK_EXIT_MS;
  }
}

function nativeViewTransition(): ((update: () => void) => unknown) | null {
  const doc = typeof document === "undefined" ? undefined : (document as Document & { startViewTransition?: (update: () => void) => unknown });
  return doc?.startViewTransition ? doc.startViewTransition.bind(doc) : null;
}

/**
 * Two-beat view swap. `shown` is the one view that is mounted (never two, never none); `leaving` is true for the exit beat
 * (apply .is-leaving), then `shown` becomes `target` and the next view rises in. Reduced motion swaps at once. Where the
 * webview has the View Transitions API it does the swap instead and `leaving` stays false.
 */
export function useViewSwap<T>(target: T, options: ViewSwapOptions = {}): { shown: T; leaving: boolean } {
  const [shown, setShown] = useState(target);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    clearTimeout(timer.current);
    if (Object.is(target, shownRef.current)) {
      setLeaving(false);
      return;
    }
    const opts = optionsRef.current;
    if ((opts.reduced ?? reducedMotion)()) {
      setShown(target);
      setLeaving(false);
      return;
    }
    const transition = opts.viewTransition === undefined ? nativeViewTransition() : opts.viewTransition;
    if (transition) {
      transition(() => flushSync(() => { setShown(target); setLeaving(false); }));
      return;
    }
    setLeaving(true);
    timer.current = setTimeout(() => {
      setShown(target);
      setLeaving(false);
    }, opts.exitMs ?? tokenExitMs());
  }, [target]);

  useEffect(() => () => clearTimeout(timer.current), []);
  return { shown, leaving };
}
