import { reducedMotion } from "./lens";

/** Port of Proteus.wave (design system bundle.js): one ring of light spreads from the orb across the Island glass on send and approve. `el` is the `.island-wave` span. Never plays under reduced motion. */
export const WAVE_MS = 900;
export const WAVE_EASING = "cubic-bezier(.16,1,.3,1)";

export function wave(el: Pick<Element, "animate"> | null | undefined): void {
  if (!el || typeof el.animate !== "function" || reducedMotion()) return;
  el.animate(
    [{ transform: "translate(-50%,-50%) scale(.2)", opacity: 0.55 }, { transform: "translate(-50%,-50%) scale(14)", opacity: 0 }],
    { duration: WAVE_MS, easing: WAVE_EASING },
  );
}
