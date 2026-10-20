import type { ReactNode } from "react";
import type { OrbState } from "../../shared/contracts";
import { ORB_STATES } from "../orb/orb-spec";

type OrbAnchorRef = (element: HTMLDivElement | null) => void;

/**
 * The hero: the empty conversation's 220px orb anchor, with its state label and the greeting under it. The anchor stays
 * mounted for the exit beat (`leaving`) so the orb's flight to the Island can still measure it; only the copy fades.
 */
export function OrbPresence({ state, anchorRef, leaving = false, children }: { state: OrbState; anchorRef: OrbAnchorRef; leaving?: boolean; children?: ReactNode }) {
  const spec = ORB_STATES[state];
  return (
    <div className={leaving ? "orb-presence orb-presence-hero is-leaving" : "orb-presence orb-presence-hero"}>
      <div className="orb-anchor" ref={anchorRef} aria-hidden="true" />
      <div className={leaving ? "hero-copy view is-leaving" : "hero-copy view"}>
        <div className="orb-meta">
          <span className="orb-label">{spec.label}</span>
          {spec.description && <span className="orb-desc">{spec.description}</span>}
        </div>
        {children}
      </div>
    </div>
  );
}
