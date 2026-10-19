import type { OrbState } from "../../shared/contracts";
import { ORB_STATES } from "../orb/orb-spec";

type OrbAnchorRef = (element: HTMLDivElement | null) => void;

export function OrbPresence({ state, docked, anchorRef }: { state: OrbState; docked: boolean; anchorRef: OrbAnchorRef }) {
  const spec = ORB_STATES[state];
  return (
    <div className={`orb-presence ${docked ? "orb-presence-docked" : "orb-presence-hero"}`}>
      <div className="orb-anchor" ref={anchorRef} aria-hidden="true" />
      <div className="orb-meta">
        <span className="orb-state-label">{spec.label}</span>
        {spec.description && <span className="orb-state-desc">{spec.description}</span>}
      </div>
    </div>
  );
}
