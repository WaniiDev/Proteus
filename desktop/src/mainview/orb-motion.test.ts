import { describe, expect, it } from "bun:test";
import { advanceOrbPlacement, measureOrbPlacement, orbPlacementTransform } from "./orb-motion";

describe("persistent orb motion", () => {
  it("measures an anchor relative to the companion and preserves a fixed canvas size", () => {
    expect(measureOrbPlacement(
      { left: 350, top: 120, width: 76, height: 76 } as DOMRect,
      { left: 100, top: 20 } as DOMRect,
    )).toEqual({ x: 250, y: 100, scaleX: 76 / 220, scaleY: 76 / 220 });
    expect(measureOrbPlacement({ left: 0, top: 0, width: 0, height: 0 } as DOMRect, { left: 0, top: 0 } as DOMRect)).toBeNull();
  });

  it("converges smoothly without overshooting and snaps for reduced motion", () => {
    const current = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
    const target = { x: 300, y: 80, scaleX: 76 / 220, scaleY: 76 / 220 };
    const next = advanceOrbPlacement(current, target, 16);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(target.x);
    expect(next.scaleX).toBeLessThan(1);
    expect(next.scaleX).toBeGreaterThan(target.scaleX);
    expect(advanceOrbPlacement(current, target, 16, true)).toEqual(target);
  });

  it("emits a compositor-friendly transform", () => {
    expect(orbPlacementTransform({ x: 12.3456, y: 8, scaleX: 0.5, scaleY: 0.5 })).toBe("translate3d(12.346px, 8px, 0) scale(0.5, 0.5)");
  });
});
