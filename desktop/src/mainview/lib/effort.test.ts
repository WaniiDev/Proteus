import { describe, expect, test } from "bun:test";
import { reasoningEfforts } from "../../shared/contracts";
import { effortHint, effortName, effortValueText, isTopLevel, levelIndex, meterStep, nearestLevel, orderedLevels } from "./effort";

describe("effort helpers", () => {
  test("level names follow the runtime order", () => {
    expect(reasoningEfforts.map(effortName)).toEqual(["Off", "Minimal", "Low", "Medium", "High", "Extra high", "Max", "Ultra"]);
    expect(effortHint("medium")).toBe("Thinks when it helps. A good default.");
  });

  test("orderedLevels sorts into runtime order and drops duplicates", () => {
    expect(orderedLevels(["max", "low", "low", "none"])).toEqual(["none", "low", "max"]);
    expect(orderedLevels(undefined)).toEqual([]);
  });

  test("nearestLevel keeps an offered level and otherwise picks the closest", () => {
    const opus = ["low", "medium", "high", "xhigh", "max"] as const;
    expect(nearestLevel(opus, "high")).toBe("high");
    expect(nearestLevel(opus, "none")).toBe("low");
    expect(nearestLevel(opus, "ultra")).toBe("max");
    expect(nearestLevel(["none", "low", "medium"], "max")).toBe("medium");
    expect(nearestLevel(["low", "high"], "medium")).toBe("low");
    expect(nearestLevel([], "high")).toBeNull();
    expect(nearestLevel(["low", "high"], null)).toBe("low");
  });

  test("levelIndex maps through the nearest level", () => {
    expect(levelIndex(["none", "low", "medium", "high", "max"], "max")).toBe(4);
    expect(levelIndex(["low", "medium"], "xhigh")).toBe(1);
    expect(levelIndex([], "low")).toBe(-1);
  });

  test("top level is the last index of any model", () => {
    expect(isTopLevel(5, 4)).toBe(true);
    expect(isTopLevel(5, 3)).toBe(false);
    expect(isTopLevel(2, 1)).toBe(true);
    expect(isTopLevel(1, 0)).toBe(false);
    expect(isTopLevel(0, -1)).toBe(false);
  });

  test("value text and meter step", () => {
    expect(effortValueText("max", true)).toBe("Max, the most this model can think");
    expect(effortValueText("high", true)).toBe("High, the most this model can think");
    expect(effortValueText("low", false)).toBe("Low");
    expect([0, 1, 2, 3, 4].map((i) => meterStep(5, i))).toEqual([0, 1, 2, 3, 4]);
    expect(meterStep(2, 1)).toBe(4);
    expect(meterStep(1, 0)).toBe(0);
  });
});
