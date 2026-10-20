import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { OrbState } from "../../shared/contracts";
import { mountOrb, type OrbFX } from "../orb/orb3d";

export type OrbHandle = { pulse: () => void; nudge: () => void; playFocusing: () => void };

export const Orb = forwardRef<OrbHandle, { state: OrbState }>(function Orb({ state }, ref) {
  const floatRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<OrbFX | null>(null);
  useLayoutEffect(() => {
    if (!floatRef.current || !canvasRef.current) return undefined;
    const controller = mountOrb(floatRef.current, canvasRef.current);
    controllerRef.current = controller;
    controller.setState(state);
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      pulse: () => controllerRef.current?.pulse(),
      nudge: () => controllerRef.current?.nudge(),
      playFocusing: () => controllerRef.current?.playFocusing(),
    }),
    [],
  );
  useEffect(() => {
    controllerRef.current?.setState(state);
  }, [state]);
  return (
    <div className="orb-float" ref={floatRef} data-state={state} data-renderer="pending">
      <div className="orb-shadow" aria-hidden="true" />
      <canvas className="orb-canvas" ref={canvasRef} aria-hidden="true" />
      <div className="orb-css" aria-hidden="true">
        <div className="orb-layer l0" />
        <div className="orb-layer l1" />
        <div className="orb-swirl" />
        <div className="orb-sheen" />
      </div>
      <div className="orb-ring r1" aria-hidden="true" />
      <div className="orb-ring r2" aria-hidden="true" />
      <div className="orb-ring r3" aria-hidden="true" />
      <div className="orb-orbit" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
});
