import { describe, expect, it } from "bun:test";
import { TaskToolPolicy } from "./task-tool-policy";

const context = { agent: { threadId: "thread-1" } };
const tasks = [{ id: "one", content: "One", activeForm: "Doing one", status: "in_progress" }];

describe("TaskToolPolicy", () => {
  it("short-circuits an exact repeated native task mutation", async () => {
    const policy = new TaskToolPolicy();
    await policy.hooks.afterToolCall?.({ toolName: "task_update", input: { id: "one", status: "in_progress" }, output: { content: "Updated", tasks, isError: false }, context });

    const repeated = await policy.hooks.beforeToolCall?.({ toolName: "task_update", input: { status: "in_progress", id: "one" }, context });

    expect(repeated).toMatchObject({ proceed: false, output: { isError: true, tasks } });
  });

  it("blocks alternating task calls after three unchanged native outputs", async () => {
    const policy = new TaskToolPolicy();
    for (const [toolName, input] of [
      ["task_update", { id: "one", status: "in_progress" }],
      ["task_complete", { id: "one" }],
      ["task_update", { id: "one", status: "in_progress" }],
      ["task_complete", { id: "one" }],
    ] as const)
      await policy.hooks.afterToolCall?.({ toolName, input, output: { content: "No change", tasks, isError: false }, context });

    const blocked = await policy.hooks.beforeToolCall?.({ toolName: "task_check", input: {}, context });

    expect(blocked).toMatchObject({ proceed: false, output: { isError: true } });
    expect((blocked as { output: { content: string } }).output.content).toContain("no progress");
  });

  it("resets its run-local repetition state", async () => {
    const policy = new TaskToolPolicy();
    await policy.hooks.afterToolCall?.({ toolName: "task_complete", input: { id: "one" }, output: { content: "Done", tasks, isError: false }, context });
    policy.reset("thread-1");

    expect(await policy.hooks.beforeToolCall?.({ toolName: "task_complete", input: { id: "one" }, context })).toBeUndefined();
  });
});
