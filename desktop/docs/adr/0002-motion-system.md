---
status: accepted
---

# The orb keeps its motion; the Island’s morph is the only layout animation

The orb’s look and motion do not change with the Island redesign (ADR 0001). It stays the WebGL sphere in `orb3d.ts`, its fifteen states and rhythms in `orb-spec.ts`, its exponential state blend, and the frame-driven placement follower in `orb-motion.ts` (`1 − e^(−9t)`, no overshoot). The new motion is around it: the Island changes shape in place (capsule ↔ card over 520ms on a small-overshoot curve), the orb flies between the hero and the Island, steps and replies arrive with short rises and un-blurs, and springs are reserved for things the person caused. The full specification and tokens (`dur-*`, `ease-*`, `stagger`, `orb-period-*`) live in the design system’s motion section.

## Considered options

- **Restyle the orb** for the new look (a CSS "liquid" body with wobble and fewer states). Rejected: the orb is the product’s identity and its states are runtime contract (`deriveOrbSteadyState`, `recoveryGate`); a new body would drift from the WebGL one people already know.
- **Fixed-duration FLIP for the orb flight** in the app, as the prototype does. Rejected for the app: the Island’s anchor itself moves while the Island morphs, and a fixed tween aimed at a moving target restarts or lands wrong. The follower re-measures every frame; the prototype’s 640ms `dur-fly` is only the budget the follower must settle within.
- **Animate layout freely** (heights, positions) across components. Rejected: it janks long threads. Everything animates `transform`, `opacity` and `filter`, except the Island’s own size change.

## Consequences

- Reduced motion must stay complete: the orb renders one still frame per state, the flight and pulses become no-ops, the Island changes shape instantly, and status still reads from colour, marks and words.
- The orb’s own tokens (`dur-blend` 460ms, `ease-breathe`, `ease-spring`, `orb-period-*`) keep their original values; changing them is an orb change, not a UI tweak.
