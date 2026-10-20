import { describe, expect, it } from "bun:test";
import { ORB_FLY_MS, advanceOrbPlacement, measureOrbPlacement, orbPlacementGap, orbPlacementTransform, type OrbPlacement } from "./orb-motion";

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

  it("settles on its anchor within the dur-fly budget at 60fps and 30fps, with no overshoot", () => {
    const hero: OrbPlacement = { x: 420, y: 160, scaleX: 1, scaleY: 1 };
    const dock: OrbPlacement = { x: 40, y: 640, scaleX: 44 / 220, scaleY: 44 / 220 };
    for (const frameMs of [1_000 / 60, 1_000 / 30]) {
      let placement = hero;
      let elapsed = 0;
      while (placement !== dock && elapsed < 2_000) {
        const next = advanceOrbPlacement(placement, dock, frameMs);
        expect(next.x).toBeGreaterThanOrEqual(dock.x);
        expect(next.y).toBeLessThanOrEqual(dock.y);
        expect(next.scaleX).toBeGreaterThanOrEqual(dock.scaleX);
        placement = next;
        elapsed += frameMs;
      }
      expect(placement).toBe(dock);
      expect(elapsed).toBeLessThanOrEqual(ORB_FLY_MS + frameMs);
    }
  });

  it("settles within the dur-fly budget for any gap up to 1200px, without overshoot", () => {
    for (const gap of [200, 800, 900, 1_000, 1_200]) {
      const dock: OrbPlacement = { x: 40, y: 40, scaleX: 44 / 220, scaleY: 44 / 220 };
      const hero: OrbPlacement = { x: 40 + gap, y: 40 + gap, scaleX: 1, scaleY: 1 };
      for (const frameMs of [1_000 / 60, 1_000 / 30]) {
        let placement = hero;
        let elapsed = 0;
        while (placement !== dock && elapsed < 2_000) {
          const next = advanceOrbPlacement(placement, dock, frameMs);
          expect(next.x).toBeGreaterThanOrEqual(dock.x);
          expect(next.y).toBeGreaterThanOrEqual(dock.y);
          expect(next.scaleX).toBeGreaterThanOrEqual(dock.scaleX);
          placement = next;
          elapsed += frameMs;
        }
        expect(placement).toBe(dock);
        expect(elapsed).toBeLessThanOrEqual(ORB_FLY_MS);
      }
    }
  });

  it("re-measures a moving anchor every frame and still lands on it", () => {
    let placement: OrbPlacement = { x: 300, y: 100, scaleX: 1, scaleY: 1 };
    let elapsed = 0;
    const anchorAt = (ms: number): OrbPlacement => ({ x: 40, y: 640 - Math.min(ms, 200) * 0.2, scaleX: 0.2, scaleY: 0.2 });
    while (orbPlacementGap(placement, anchorAt(elapsed)) > 0 && elapsed < 2_000) {
      placement = advanceOrbPlacement(placement, anchorAt(elapsed), 16);
      elapsed += 16;
    }
    expect(placement).toEqual(anchorAt(elapsed - 16));
    expect(elapsed).toBeLessThanOrEqual(ORB_FLY_MS + 16);
  });
});
