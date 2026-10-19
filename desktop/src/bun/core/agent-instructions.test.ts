import { describe, expect, it } from "bun:test";
import { AGENT_INSTRUCTIONS } from "./agent-instructions";

describe("Proteus agent instructions", () => {
  it("treats explicit placeholder plans as contained write-then-submit work", () => {
    expect(AGENT_INSTRUCTIONS).toContain("contained private plan workspace");
    expect(AGENT_INSTRUCTIONS).toContain("placeholder or example plan");
    expect(AGENT_INSTRUCTIONS).toContain("write_plan");
    expect(AGENT_INSTRUCTIONS).toContain("immediately call submit_plan");
    expect(AGENT_INSTRUCTIONS).toContain("Never claim that plan-file writing is unavailable");
  });

  it("requires native calls using the exact Mastra tool names", () => {
    expect(AGENT_INSTRUCTIONS).toContain("exact bare names");
    expect(AGENT_INSTRUCTIONS).toContain("native tool-call interface");
    expect(AGENT_INSTRUCTIONS).toContain("Never prefix a tool with functions.");
    expect(AGENT_INSTRUCTIONS).toContain("do not imitate a tool call");
  });
});
