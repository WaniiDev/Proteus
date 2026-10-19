import { describe, expect, it } from "bun:test";
import { TaskSignalProvider } from "@mastra/core/signals";

describe("installed Mastra contracts", () => {
  it("uses TaskSignalProvider as the complete native task bundle", () => {
    const provider = new TaskSignalProvider();

    expect(Object.keys(provider.getTools()).sort()).toEqual(["task_check", "task_complete", "task_update", "task_write"]);
    expect(provider.getInputProcessors().map((processor) => ("id" in processor ? processor.id : undefined))).toContain("task-state");
  });
});
