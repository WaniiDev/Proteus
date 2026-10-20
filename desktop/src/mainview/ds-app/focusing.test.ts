import { describe, expect, it } from "bun:test";
import { shouldPlayFocusing } from "./focusing";
import { surgeGeometry } from "./surge";

const base = { arrivedAtTop: true, runActive: false, reducedMotion: false, alreadyPlayedForThisArrival: false };

describe("shouldPlayFocusing", () => {
  it("plays on arrival at the top level", () => expect(shouldPlayFocusing(base)).toBe(true));
  it("does not play without an arrival", () => expect(shouldPlayFocusing({ ...base, arrivedAtTop: false })).toBe(false));
  it("never plays while a run is going", () => expect(shouldPlayFocusing({ ...base, runActive: true })).toBe(false));
  it("never plays under reduced motion", () => expect(shouldPlayFocusing({ ...base, reducedMotion: true })).toBe(false));
  it("plays at most once per arrival", () => expect(shouldPlayFocusing({ ...base, alreadyPlayedForThisArrival: true })).toBe(false));
});

describe("surgeGeometry", () => {
  it("centres on the origin in the layer's space and reaches the farthest corner", () => {
    const g = surgeGeometry({ left: 100, top: 50, width: 800, height: 600 }, { left: 460, top: 100, width: 80, height: 80 });
    expect(g).toEqual({ x: 400, y: 90, size: 80, reach: Math.hypot(400, 510) });
  });
});
