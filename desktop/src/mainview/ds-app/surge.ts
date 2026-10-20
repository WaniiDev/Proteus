/**
 * Port of Proteus.surge (design system bundle.js): the stage-wide moment of the orb's focusing state.
 *
 * Markup (the DS styles it; `.surge` sits at var(--z-surge) over the stage, under the Island, and never takes the pointer):
 *   <div class="surge" aria-hidden="true"><i class="surge-focus"></i><i class="surge-glow"></i><i class="surge-ring r1"></i><i class="surge-ring r2"></i></div>
 * `ensureSurgeLayer(parent)` builds that layer once.
 *
 * First half: the stage blurs and dims toward the edges, light gathers into the orb, the stage eases to .97 toward it.
 * Second half: the light blooms out, two shockwave rings cross the stage, the glass ripples (lensRipple), the stage springs back.
 * Nothing plays under reduced motion.
 */
import { lensRipple, reducedMotion } from "./lens";

export const SURGE_MS = 2200;
export const SURGE_RING_MS = 1100;
export const SURGE_RING_STAGGER_MS = 140;
export const SURGE_STAGE_SCALE = 0.97;

export type SurgeOptions = {
  /** The content to pull in toward the orb (the scrolling stage). */
  stage?: HTMLElement | null;
  /** The whole moment. Default 2200ms. */
  duration?: number;
};

export type SurgeGeometry = { x: number; y: number; size: number; reach: number };

/** Where the light gathers (the orb's centre in the layer's space) and how far the rings must travel to leave the layer. */
export function surgeGeometry(layer: Pick<DOMRect, "left" | "top" | "width" | "height">, origin: Pick<DOMRect, "left" | "top" | "width" | "height">): SurgeGeometry {
  const x = origin.left + origin.width / 2 - layer.left;
  const y = origin.top + origin.height / 2 - layer.top;
  const reach = Math.hypot(Math.max(x, layer.width - x), Math.max(y, layer.height - y));
  return { x, y, size: origin.width, reach };
}

/** The `.surge` layer, appended to `parent` once. Returns the existing layer on later calls. */
export function ensureSurgeLayer(parent: HTMLElement): HTMLElement {
  const existing = parent.querySelector<HTMLElement>(":scope > .surge");
  if (existing) return existing;
  const layer = parent.ownerDocument.createElement("div");
  layer.className = "surge";
  layer.setAttribute("aria-hidden", "true");
  layer.innerHTML = '<i class="surge-focus"></i><i class="surge-glow"></i><i class="surge-ring r1"></i><i class="surge-ring r2"></i>';
  parent.appendChild(layer);
  return layer;
}

/** Plays the surge. Returns false (and does nothing) when it cannot play, including under reduced motion. */
export function surge(layer: HTMLElement | null | undefined, origin: HTMLElement | null | undefined, opts: SurgeOptions = {}): boolean {
  if (!layer || !origin || typeof layer.animate !== "function" || reducedMotion()) return false;
  const total = opts.duration ?? SURGE_MS;
  const half = total / 2;
  const { x, y, size, reach } = surgeGeometry(layer.getBoundingClientRect(), origin.getBoundingClientRect());
  layer.style.setProperty("--sx", `${x}px`);
  layer.style.setProperty("--sy", `${y}px`);
  layer.style.setProperty("--sr", `${size}px`);

  layer.querySelector<HTMLElement>(".surge-focus")?.animate(
    [
      { opacity: 0, easing: "cubic-bezier(.5,0,.2,1)" },
      { opacity: 1, offset: 0.5, easing: "cubic-bezier(.4,0,.2,1)" },
      { opacity: 0 },
    ],
    { duration: total },
  );
  layer.querySelector<HTMLElement>(".surge-glow")?.animate(
    [
      { opacity: 0, transform: "scale(1.35)", easing: "cubic-bezier(.55,0,.75,.2)" },
      { opacity: 0.95, transform: "scale(.22)", offset: 0.5, easing: "cubic-bezier(.16,1,.3,1)" },
      { opacity: 0, transform: "scale(2)" },
    ],
    { duration: total },
  );

  // Rings are drawn at their final size and scaled up from the orb's, so their edge ends crisp instead of magnified.
  const d = reach * 2.1;
  const s0 = size / d;
  layer.querySelectorAll<HTMLElement>(".surge-ring").forEach((ring, i) => {
    ring.style.width = ring.style.height = `${d}px`;
    ring.style.margin = `${-d / 2}px 0 0 ${-d / 2}px`;
    ring.animate(
      [
        { opacity: 0, transform: `scale(${s0})` },
        { opacity: 1, transform: `scale(${s0 * 1.3})`, offset: 0.06 },
        { opacity: 0, transform: "scale(1)" },
      ],
      { duration: SURGE_RING_MS, delay: half + i * SURGE_RING_STAGGER_MS, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" },
    );
  });

  const stage = opts.stage;
  if (stage && typeof stage.animate === "function") {
    const s = stage.getBoundingClientRect();
    const o = origin.getBoundingClientRect();
    stage.style.transformOrigin = `${o.left + o.width / 2 - s.left}px ${o.top + o.height / 2 - s.top}px`;
    stage.animate(
      [
        { transform: "scale(1)", easing: "cubic-bezier(.5,0,.75,0)" },
        { transform: `scale(${SURGE_STAGE_SCALE})`, offset: 0.5, easing: "cubic-bezier(.32,1.18,.4,1)" },
        { transform: "scale(1)" },
      ],
      { duration: total },
    );
  }
  setTimeout(lensRipple, half);
  return true;
}
