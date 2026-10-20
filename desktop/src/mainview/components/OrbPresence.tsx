import type { OrbState } from "../../shared/contracts";
import { ORB_STATES } from "../orb/orb-spec";

type OrbAnchorRef = (element: HTMLDivElement | null) => void;

/** The hero: the empty conversation's 220px orb anchor with its state label and description under it. Once the conversation starts the orb lives in the Island's orb slot. */
export function OrbPresence({ state, anchorRef }: { state: OrbState; anchorRef: OrbAnchorRef }) {
  const spec = ORB_STATES[state];
  return (
    <div className="orb-presence orb-presence-hero">
      <div className="orb-anchor" ref={anchorRef} aria-hidden="true" />
      <div className="orb-meta">
        <span className="orb-state-label">{spec.label}</span>
        {spec.description && <span className="orb-state-desc">{spec.description}</span>}
      </div>
    </div>
  );
}
