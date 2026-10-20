/**
 * The focusing moment: the orb's 16th state and the stage surge, played when the person moves thinking to the model's top level.
 *
 * API for the Composer lane:
 *   const { onTopLevel } = useFocusingMoment({ orb, surgeLayer, origin, stage, runActive });
 *   <EffortSlider ... onTopLevel={onTopLevel} />
 *
 *   orb          () => OrbHandle | null          the orb's handle (playFocusing, pulse)
 *   surgeLayer   () => HTMLElement | null        the `.surge` layer over the stage (ensureSurgeLayer(stageParent) builds it)
 *   origin       () => HTMLElement | null        the element the light gathers into: the Island orb in a chat, the hero orb otherwise
 *   stage        () => HTMLElement | null        optional: the content that eases toward the orb
 *   runActive    boolean                         a run is going (Mastra owns this): nothing plays
 *   onTopLevel   stable callback for EffortSlider's onTopLevel (the slider already calls it only on arrival)
 *   onLeaveTop   optional: call when thinking leaves the top level to re-arm before the moment has ended
 *
 * The rule is shouldPlayFocusing(): once per arrival, never during a run, nothing under reduced motion
 * (no orb state change, no surge). The orb returns to its previous state at 2.2s by itself.
 * Not wired into Composer here.
 */
import { useCallback, useEffect, useRef } from "react";
import type { OrbHandle } from "../components/Orb";
import { FOCUSING_TOTAL_MS } from "../orb/orb3d";
import { reducedMotion } from "./lens";
import { SURGE_MS, surge } from "./surge";

export type FocusingInput = {
  arrivedAtTop: boolean;
  runActive: boolean;
  reducedMotion: boolean;
  alreadyPlayedForThisArrival: boolean;
};

export function shouldPlayFocusing({ arrivedAtTop, runActive, reducedMotion: reduced, alreadyPlayedForThisArrival }: FocusingInput): boolean {
  return arrivedAtTop && !runActive && !reduced && !alreadyPlayedForThisArrival;
}

export type FocusingMomentOptions = {
  orb: () => OrbHandle | null;
  surgeLayer: () => HTMLElement | null;
  origin: () => HTMLElement | null;
  stage?: () => HTMLElement | null;
  runActive: boolean;
};

export function useFocusingMoment(options: FocusingMomentOptions): { onTopLevel: () => void; onLeaveTop: () => void } {
  const latest = useRef(options);
  latest.current = options;
  const played = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onLeaveTop = useCallback(() => {
    played.current = false;
  }, []);

  const onTopLevel = useCallback(() => {
    const current = latest.current;
    const play = shouldPlayFocusing({
      arrivedAtTop: true,
      runActive: current.runActive,
      reducedMotion: reducedMotion(),
      alreadyPlayedForThisArrival: played.current,
    });
    if (!play) return;
    played.current = true;
    if (timer.current) clearTimeout(timer.current);
    // The flag also clears when the moment ends, so a later arrival is never swallowed if onLeaveTop is not wired.
    timer.current = setTimeout(() => {
      played.current = false;
      timer.current = null;
    }, Math.max(FOCUSING_TOTAL_MS, SURGE_MS));
    current.orb()?.playFocusing();
    surge(current.surgeLayer(), current.origin(), { stage: current.stage?.() ?? null, duration: SURGE_MS });
  }, []);

  return { onTopLevel, onLeaveTop };
}
