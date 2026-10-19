import { describe, expect, it } from "bun:test";
import { isDeclinedToolResult, MASTRA_TOOL_DECLINED_MESSAGE } from "./tool-decision";

describe("Mastra tool decision normalization", () => {
  it("recognizes every supported decline representation before generic completion", () => {
    expect(isDeclinedToolResult({ state: "output-denied" })).toBeTrue();
    expect(isDeclinedToolResult({ state: "output-available", approval: { approved: false } })).toBeTrue();
    expect(isDeclinedToolResult({ state: "output-available", output: MASTRA_TOOL_DECLINED_MESSAGE })).toBeTrue();
    expect(isDeclinedToolResult({ state: "output-available", output: { content: MASTRA_TOOL_DECLINED_MESSAGE } })).toBeTrue();
  });

  it("does not misclassify an ordinary completed result", () => {
    expect(isDeclinedToolResult({ state: "output-available", approval: { approved: true }, output: { content: "Saved" } })).toBeFalse();
  });
});
