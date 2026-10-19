import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import type { OrbState } from "../../shared/contracts";
import { advanceOrbPlacement, measureOrbPlacement, orbPlacementTransform, type OrbPlacement } from "../orb/orb-motion";
import { Orb, type OrbHandle } from "./Orb";

export function PersistentOrbSurface({ state, docked, animateDock, pulseVersion, orbRef, heroAnchor, dockAnchor }: { state: OrbState; docked: boolean; animateDock: boolean; pulseVersion: number; orbRef: MutableRefObject<OrbHandle | null>; heroAnchor: HTMLDivElement | null; dockAnchor: HTMLDivElement | null }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const placementRef = useRef<OrbPlacement | null>(null);
  const previousDockedRef = useRef(docked);
  const previousPulseRef = useRef(pulseVersion);
  useEffect(() => {
    const anchor = docked ? dockAnchor : heroAnchor;
    if (!anchor) return undefined;
    const companion = anchor.closest<HTMLElement>(".companion-view");
    if (!companion) return undefined;
    let frameId = 0;
    let previousTime = performance.now();
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const placeSurface = (time: number) => {
      const target = measureOrbPlacement(anchor.getBoundingClientRect(), companion.getBoundingClientRect());
      const surface = surfaceRef.current;
      if (target && surface) {
        const current = placementRef.current;
        const next = current ? advanceOrbPlacement(current, target, time - previousTime, reducedMotion) : target;
        placementRef.current = next;
        surface.style.transform = orbPlacementTransform(next);
        surface.style.opacity = "1";
      }
      previousTime = time;
      frameId = requestAnimationFrame(placeSurface);
    };
    frameId = requestAnimationFrame(placeSurface);
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [docked, dockAnchor, heroAnchor]);
  useLayoutEffect(() => {
    if (animateDock && docked && !previousDockedRef.current) orbRef.current?.pulse();
    previousDockedRef.current = docked;
  }, [animateDock, docked, orbRef]);
  useEffect(() => {
    if (pulseVersion !== previousPulseRef.current) {
      orbRef.current?.pulse();
      previousPulseRef.current = pulseVersion;
    }
  }, [orbRef, pulseVersion]);
  return (
    <div ref={surfaceRef} className={`persistent-orb-surface ${docked ? "is-docked" : "is-hero"}`} aria-hidden="true">
      <Orb ref={orbRef} state={state} />
    </div>
  );
}
