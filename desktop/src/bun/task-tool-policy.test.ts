import { describe, expect, it } from "bun:test";
import { TaskToolPolicy } from "./task-tool-policy";

const context = { agent: { threadId: "thread-1" } };
const tasks = [{ id: "one", content: "One", activeForm: "Doing one", status: "in_progress" }];

describe("TaskToolPolicy", () => {
  it("terminates the reported task-only workflow after one successful final check", async () => {
    const prompt = "Create task using task tools and finish one by one without creating any plan using only task tools";
    expect(prompt).toContain("only task tools");
    const policy = new TaskToolPolicy();
    const task = (id: string, status: "pending" | "in_progress" | "completed") => ({
      id,
      content: id,
      activeForm: `Working on ${id}`,
      status,
    });
    const calls = [
      { toolName: "task_write", input: { tasks: ["setup", "review", "finalize"] }, tasks: [task("setup", "in_progress"), task("review", "pending"), task("finalize", "pending")] },
      { toolName: "task_complete", input: { id: "setup" }, tasks: [task("setup", "completed"), task("review", "pending"), task("finalize", "pending")] },
      { toolName: "task_update", input: { id: "review", status: "in_progress" }, tasks: [task("setup", "completed"), task("review", "in_progress"), task("finalize", "pending")] },
      { toolName: "task_complete", input: { id: "review" }, tasks: [task("setup", "completed"), task("review", "completed"), task("finalize", "pending")] },
      { toolName: "task_update", input: { id: "finalize", status: "in_progress" }, tasks: [task("setup", "completed"), task("review", "completed"), task("finalize", "in_progress")] },
      { toolName: "task_complete", input: { id: "finalize" }, tasks: [task("setup", "completed"), task("review", "completed"), task("finalize", "completed")] },
      { toolName: "task_check", input: {}, tasks: [task("setup", "completed"), task("review", "completed"), task("finalize", "completed")], summary: { allCompleted: true } },
    ] as const;

    const steps = [] as Array<{ toolResults: Array<{ toolName: string; output: unknown }> }>;
    for (const call of calls) {
      const output = { content: `${call.toolName} completed`, tasks: call.tasks, isError: false, ...(call.toolName === "task_check" ? { summary: call.summary } : {}) };
      await policy.hooks.afterToolCall?.({ toolName: call.toolName, input: call.input, output, context });
      steps.push({ toolResults: [{ toolName: call.toolName, output }] });
    }

    expect(calls.map(({ toolName }) => toolName)).toEqual([
      "task_write", "task_complete", "task_update", "task_complete", "task_update", "task_complete", "task_check",
    ]);
    expect(policy.prepareStep({ steps })).toEqual({ toolChoice: "none" });
  });

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

    expect(blocked).toBeUndefined();
    const mutation = await policy.hooks.beforeToolCall?.({ toolName: "task_update", input: { id: "one", status: "in_progress" }, context });
    expect(mutation).toMatchObject({ proceed: false, output: { isError: false, tasks } });
  });

  it("never treats task_check as a repeated mutation", async () => {
    const policy = new TaskToolPolicy();
    const output = { content: "All complete", tasks, isError: false, summary: { allCompleted: true } };
    await policy.hooks.afterToolCall?.({ toolName: "task_check", input: {}, output, context });

    expect(await policy.hooks.beforeToolCall?.({ toolName: "task_check", input: {}, context })).toBeUndefined();
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
