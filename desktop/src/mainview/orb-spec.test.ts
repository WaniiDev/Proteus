import { describe, expect, it } from "bun:test";
import { orbStates } from "../shared/contracts";
import { ORB_STATES } from "./orb-spec";

describe("orb visual contract", () => {
  it("contains every guide state with a pastel palette and motion target", () => {
    expect(Object.keys(ORB_STATES)).toEqual([...orbStates]);
    for (const state of orbStates) {
      const spec = ORB_STATES[state];
      expect(spec.a).toMatch(/^#[0-9a-f]{6}$/i);
      expect(spec.b).toMatch(/^#[0-9a-f]{6}$/i);
      expect(spec.amp).toBeGreaterThanOrEqual(0);
      expect(spec.speed).toBeGreaterThanOrEqual(0);
      expect(spec.freq).toBeGreaterThan(0);
      expect(spec.scale).toBeGreaterThan(0);
    }
  });

  it("keeps the guide's key liquid extremes", () => {
    expect(ORB_STATES.idle).toMatchObject({ amp: 0.10, speed: 0.40, a: "#a7e5d3", b: "#c8b8e0" });
    expect(ORB_STATES.working).toMatchObject({ amp: 0.27, speed: 1.65, a: "#f4c5a8", b: "#c8b8e0" });
    expect(ORB_STATES.interrupted).toMatchObject({ amp: 0.03, speed: 0.10, scale: 0.80 });
    expect(ORB_STATES.done).toMatchObject({ scale: 1.12, a: "#a7e5d3", b: "#d8f3e8" });
  });
});
