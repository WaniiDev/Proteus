export const ORB_SURFACE_SIZE = 220;

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

/** Frame-rate-independent smoothing without overshoot or transition restarts. */
export function advanceOrbPlacement(current: OrbPlacement, target: OrbPlacement, elapsedMs: number, reducedMotion = false): OrbPlacement {
  if (reducedMotion) return target;
  const elapsedSeconds = Math.min(Math.max(elapsedMs, 0) / 1_000, 0.05);
  const blend = 1 - Math.exp(-9 * elapsedSeconds);
  return {
    x: current.x + (target.x - current.x) * blend,
    y: current.y + (target.y - current.y) * blend,
    scaleX: current.scaleX + (target.scaleX - current.scaleX) * blend,
    scaleY: current.scaleY + (target.scaleY - current.scaleY) * blend,
  };
}

export function orbPlacementTransform(placement: OrbPlacement): string {
  const value = (number: number) => Math.round(number * 1_000) / 1_000;
  return `translate3d(${value(placement.x)}px, ${value(placement.y)}px, 0) scale(${value(placement.scaleX)}, ${value(placement.scaleY)})`;
}
