import { describe, expect, test } from "bun:test";
import { toolResultError } from "./tool-result-error";

describe("toolResultError", () => {
  test("recognizes Mastra and structured validation failures", () => {
    expect(toolResultError({ isError: true, content: "Mastra failure" })).toBe("Mastra failure");
    expect(toolResultError({ error: true, message: "Validation failure" })).toBe("Validation failure");
    expect(toolResultError({ error: "Command failure" })).toBe("Command failure");
    expect(toolResultError({ error: false, message: "ordinary output" })).toBeUndefined();
  });
});
