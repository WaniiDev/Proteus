import { describe, expect, it } from "bun:test";
import type { ProcessInputStepArgs } from "@mastra/core/processors";
import type { TaskItemSnapshot } from "@mastra/core/tools";
import { TaskToolPolicy } from "./task-tool-policy";

const tasks: TaskItemSnapshot[] = [{ id: "one", content: "Complete one", activeForm: "Completing one", status: "completed" }];
const context = (threadId = "thread-1") => ({ agent: { threadId } });
const stepArgs = (steps: unknown[] = [], threadId = "thread-1", stepNumber = 1) => ({ stepNumber, steps, requestContext: { get: (key: string) => key === "controller" ? { threadId } : undefined } }) as unknown as ProcessInputStepArgs;

describe("TaskToolPolicy", () => {
  it("returns the last native snapshot for an exact repeated call and ends the tool loop", async () => {
    const policy = new TaskToolPolicy();
    await policy.hooks.afterToolCall?.({ toolName: "task_complete", input: { id: "one" }, output: { content: "Done", tasks, isError: false }, context: context() });
    const repeated = await policy.hooks.beforeToolCall?.({ toolName: "task_complete", input: { id: "one" }, context: context() });
    expect(repeated).toMatchObject({ proceed: false, output: { tasks, isError: false } });
    expect(policy.prepareStep(stepArgs())).toEqual({ toolChoice: "none" });
  });

  it("keeps the last native snapshot monotonic while leaving a different task mutation available", async () => {
    const policy = new TaskToolPolicy();
    await policy.hooks.afterToolCall?.({ toolName: "task_complete", input: { id: "one" }, output: { content: "Done", tasks, isError: false }, context: context() });
    expect(await policy.hooks.beforeToolCall?.({ toolName: "task_update", input: { id: "one", status: "in_progress" }, context: context() })).toMatchObject({ proceed: false, output: { tasks } });
    expect(await policy.hooks.beforeToolCall?.({ toolName: "task_write", input: { tasks }, context: context() })).toBeUndefined();
  });

  it("forces one final text-only step after native allCompleted", async () => {
    const policy = new TaskToolPolicy();
    await policy.hooks.afterToolCall?.({ toolName: "task_check", input: {}, output: { content: "Done", tasks, isError: false, summary: { allCompleted: true } }, context: context() });
    expect(policy.prepareStep(stepArgs())).toEqual({ toolChoice: "none" });
    expect(policy.prepareStep(stepArgs([{ toolResults: [{ toolName: "task_check", output: { content: "Done", tasks, isError: false, summary: { allCompleted: true } } }] }], "new-thread"))).toEqual({ toolChoice: "none" });
  });

  it("resets all guard state for a new run", async () => {
    const policy = new TaskToolPolicy();
    await policy.hooks.afterToolCall?.({ toolName: "task_complete", input: { id: "one" }, output: { content: "Done", tasks, isError: false }, context: context() });
    policy.reset("thread-1");
    expect(await policy.hooks.beforeToolCall?.({ toolName: "task_complete", input: { id: "one" }, context: context() })).toBeUndefined();
  });

  it("clears a completed run synchronously at Mastra step zero", async () => {
    const policy = new TaskToolPolicy();
    await policy.hooks.afterToolCall?.({ toolName: "task_check", input: {}, output: { content: "Done", tasks, isError: false, summary: { allCompleted: true } }, context: context() });
    expect(policy.prepareStep(stepArgs())).toEqual({ toolChoice: "none" });

    expect(policy.prepareStep(stepArgs([], "thread-1", 0))).toBeUndefined();
    expect(policy.prepareStep(stepArgs([], "thread-1", 1))).toBeUndefined();
  });
});
