import { describe, expect, it } from "bun:test";
import { TaskToolPolicy } from "./task-tool-policy";

const context = { agent: { threadId: "thread-1" } };
const tasks = [{ id: "one", content: "One", activeForm: "Doing one", status: "in_progress" }];

describe("TaskToolPolicy", () => {
  it("short-circuits an exact repeated native task mutation", async () => {
    const policy = new TaskToolPolicy();
    await policy.hooks.afterToolCall?.({ toolName: "task_update", input: { id: "one", status: "in_progress" }, output: { content: "Updated", tasks, isError: false }, context });

    const repeated = await policy.hooks.beforeToolCall?.({ toolName: "task_update", input: { status: "in_progress", id: "one" }, context });

    expect(repeated).toMatchObject({ proceed: false, output: { isError: false, tasks } });
  });

  it("returns an idempotent native snapshot after repeated no-progress mutations", async () => {
    const policy = new TaskToolPolicy();
    for (const [toolName, input] of [
      ["task_update", { id: "one", status: "in_progress" }],
      ["task_complete", { id: "one" }],
      ["task_update", { id: "one", status: "in_progress" }],
      ["task_complete", { id: "one" }],
    ] as const)
      await policy.hooks.afterToolCall?.({ toolName, input, output: { content: "No change", tasks, isError: false }, context });

    const blocked = await policy.hooks.beforeToolCall?.({ toolName: "task_check", input: {}, context });

    expect(blocked).toMatchObject({ proceed: false, output: { isError: false, tasks } });
    const mutation = await policy.hooks.beforeToolCall?.({ toolName: "task_update", input: { id: "one", status: "in_progress" }, context });
    expect(mutation).toMatchObject({ proceed: false, output: { isError: false, tasks } });
  });

  it("returns a cached result for a repeated incomplete task_check", async () => {
    const policy = new TaskToolPolicy();
    const output = { content: "Still working", tasks, isError: false, summary: { allCompleted: false } };
    await policy.hooks.afterToolCall?.({ toolName: "task_check", input: {}, output, context });

    expect(await policy.hooks.beforeToolCall?.({ toolName: "task_check", input: {}, context })).toMatchObject({
      proceed: false,
      output: { isError: false, tasks },
    });
  });

  it("uses the native afterToolCall result as the terminal prepareStep latch", async () => {
    const policy = new TaskToolPolicy();
    const completedTasks = [{ ...tasks[0], status: "completed" }];
    await policy.hooks.afterToolCall?.({
      toolName: "task_check",
      input: {},
      output: { content: "All complete", tasks: completedTasks, isError: false, summary: { allCompleted: true } },
      context,
    });

    expect(policy.prepareStep({ steps: [], messages: [{ threadId: "thread-1" }] })).toEqual({ toolChoice: "none" });
    expect(await policy.hooks.beforeToolCall?.({ toolName: "task_check", input: {}, context })).toMatchObject({
      proceed: false,
      output: { isError: false, tasks: completedTasks },
    });
  });

  it("forces the step after a completed task_check to be text-only", () => {
    const policy = new TaskToolPolicy();
    const result = policy.prepareStep({
      steps: [
        {
          toolResults: [
            {
              toolName: "task_check",
              output: { content: "All complete", tasks, isError: false, summary: { allCompleted: true } },
            },
          ],
        },
      ],
    });

    expect(result).toEqual({ toolChoice: "none" });
  });

  it("bounds three unchanged task snapshots with a text-only step", () => {
    const policy = new TaskToolPolicy();
    const steps = ["task_update", "task_complete", "task_update"].map((toolName) => ({
      toolResults: [{ toolName, result: { content: "No change", tasks, isError: false } }],
    }));

    expect(policy.prepareStep({ steps })).toEqual({ toolChoice: "none" });
  });

  it("resets its run-local repetition state", async () => {
    const policy = new TaskToolPolicy();
    await policy.hooks.afterToolCall?.({ toolName: "task_complete", input: { id: "one" }, output: { content: "Done", tasks, isError: false }, context });
    policy.reset("thread-1");

    expect(await policy.hooks.beforeToolCall?.({ toolName: "task_complete", input: { id: "one" }, context })).toBeUndefined();
  });
});
