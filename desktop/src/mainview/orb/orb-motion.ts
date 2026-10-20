export const ORB_SURFACE_SIZE = 220;
/** --dur-fly: the budget for the hero-to-Island flight. */
export const ORB_FLY_MS = 640;
/** The follower snaps onto its anchor once every edge is within this many px (scale counted against the 220px surface). */
export const ORB_SETTLE_PX = 2;

export type OrbPlacement = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
};

type RectLike = Pick<DOMRect, "left" | "top" | "width" | "height">;

export function measureOrbPlacement(anchor: RectLike, container: Pick<DOMRect, "left" | "top">): OrbPlacement | null {
  if (anchor.width <= 0 || anchor.height <= 0) return null;
  return {
    x: anchor.left - container.left,
    y: anchor.top - container.top,
    scaleX: anchor.width / ORB_SURFACE_SIZE,
    scaleY: anchor.height / ORB_SURFACE_SIZE,
  };
}

/**
 * Exponential approach rate per second. A gap g settles in ln(g / ORB_SETTLE_PX) / rate, so 11.5 settles a 1200px gap in
 * about 560ms, inside ORB_FLY_MS with room for frame quantisation (9 took 667-700ms for 800-1000px).
 */
const ORB_RATE = 11.5;

/** Frame-rate-independent smoothing without overshoot or transition restarts. */
export function advanceOrbPlacement(current: OrbPlacement, target: OrbPlacement, elapsedMs: number, reducedMotion = false): OrbPlacement {
  if (reducedMotion) return target;
  const elapsedSeconds = Math.min(Math.max(elapsedMs, 0) / 1_000, 0.05);
  const blend = 1 - Math.exp(-ORB_RATE * elapsedSeconds);
  const next = {
    x: current.x + (target.x - current.x) * blend,
    y: current.y + (target.y - current.y) * blend,
    scaleX: current.scaleX + (target.scaleX - current.scaleX) * blend,
    scaleY: current.scaleY + (target.scaleY - current.scaleY) * blend,
  };
  return orbPlacementGap(next, target) <= ORB_SETTLE_PX ? target : next;
}

/** The largest remaining edge in px between a placement and its target. */
export function orbPlacementGap(placement: OrbPlacement, target: OrbPlacement): number {
  return Math.max(
    Math.abs(target.x - placement.x),
    Math.abs(target.y - placement.y),
    Math.abs(target.scaleX - placement.scaleX) * ORB_SURFACE_SIZE,
    Math.abs(target.scaleY - placement.scaleY) * ORB_SURFACE_SIZE,
  );
}

export function orbPlacementTransform(placement: OrbPlacement): string {
  const value = (number: number) => Math.round(number * 1_000) / 1_000;
  return `translate3d(${value(placement.x)}px, ${value(placement.y)}px, 0) scale(${value(placement.scaleX)}, ${value(placement.scaleY)})`;
}
