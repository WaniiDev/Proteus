import { describe, expect, it } from "bun:test";
import type { ProcessInputStepArgs } from "@mastra/core/processors";
import type { TaskItemSnapshot } from "@mastra/core/tools";
import { TaskToolPolicy } from "./task-tool-policy";

function task(id: string, status: TaskItemSnapshot["status"]): TaskItemSnapshot {
  return { id, content: `Complete ${id}`, activeForm: `Completing ${id}`, status };
}

function context(threadId = "thread-1") {
  return { agent: { threadId } };
}

function stepArgs(steps: unknown[] = [], threadId = "thread-1"): ProcessInputStepArgs {
  return {
    steps,
    requestContext: { get: (key: string) => key === "controller" ? { threadId } : undefined },
  } as unknown as ProcessInputStepArgs;
}

async function record(
  policy: TaskToolPolicy,
  toolName: string,
  input: unknown,
  tasks: TaskItemSnapshot[],
  options: { isError?: boolean; allCompleted?: boolean; threadId?: string; content?: string } = {},
) {
  await policy.hooks.afterToolCall?.({
    toolName,
    input,
    output: {
      content: options.content ?? `${toolName} result`,
      tasks,
      isError: options.isError ?? false,
      ...(options.allCompleted === undefined ? {} : { summary: { allCompleted: options.allCompleted } }),
    },
    context: context(options.threadId),
  });
}

describe("TaskToolPolicy", () => {
  it("short-circuits an exact repeated native task mutation", async () => {
    const policy = new TaskToolPolicy();
    const tasks = [task("one", "in_progress")];
    await record(policy, "task_update", { id: "one", status: "in_progress" }, tasks);

    const repeated = await policy.hooks.beforeToolCall?.({
      toolName: "task_update",
      input: { status: "in_progress", id: "one" },
      context: context(),
    });

    expect(repeated).toMatchObject({ proceed: false, output: { isError: false, tasks } });
  });

  it("keeps completed tasks terminal within a task-list revision", async () => {
    const policy = new TaskToolPolicy();
    const tasks = [task("one", "completed"), task("two", "pending")];
    await record(policy, "task_complete", { id: "one" }, tasks);

    const reopen = await policy.hooks.beforeToolCall?.({
      toolName: "task_update",
      input: { id: "one", status: "in_progress" },
      context: context(),
    });

    expect(reopen).toMatchObject({ proceed: false, output: { isError: false, tasks } });
    expect((reopen as { output: { content: string } }).output.content).toContain("Next incomplete task: two (pending)");
    expect(policy.prepareStep(stepArgs())).toBeUndefined();

    await policy.hooks.beforeToolCall?.({
      toolName: "task_update",
      input: { id: "one", status: "in_progress" },
      context: context(),
    });
    expect(policy.prepareStep(stepArgs())).toEqual({ toolChoice: "none" });
  });

  it("allows task_write to start an explicit replan revision", async () => {
    const policy = new TaskToolPolicy();
    await record(policy, "task_complete", { id: "one" }, [task("one", "completed")]);
    const replanInput = { tasks: [task("one", "pending"), task("two", "pending")] };

    expect(await policy.hooks.beforeToolCall?.({ toolName: "task_write", input: replanInput, context: context() })).toBeUndefined();
    await record(policy, "task_write", replanInput, replanInput.tasks);
    expect(await policy.hooks.beforeToolCall?.({
      toolName: "task_update",
      input: { id: "one", status: "in_progress" },
      context: context(),
    })).toBeUndefined();
  });

  it("blocks no-op updates and duplicate completion from the canonical snapshot", async () => {
    const policy = new TaskToolPolicy();
    const tasks = [task("one", "completed"), task("two", "in_progress")];
    await record(policy, "task_update", { id: "two", status: "in_progress" }, tasks);

    expect(await policy.hooks.beforeToolCall?.({
      toolName: "task_update",
      input: { id: "two", activeForm: "Completing two" },
      context: context(),
    })).toMatchObject({ proceed: false, output: { tasks, isError: false } });

    await record(policy, "task_update", { id: "two", status: "in_progress" }, tasks);
    expect(await policy.hooks.beforeToolCall?.({ toolName: "task_complete", input: { id: "one" }, context: context() }))
      .toMatchObject({ proceed: false, output: { tasks, isError: false } });
  });

  it("does not let a native error replace the last successful task snapshot", async () => {
    const policy = new TaskToolPolicy();
    const canonical = [task("one", "completed"), task("two", "pending")];
    await record(policy, "task_complete", { id: "one" }, canonical);
    await record(policy, "task_update", { id: "missing", status: "in_progress" }, [], { isError: true, content: "Task not found" });

    const repeated = await policy.hooks.beforeToolCall?.({
      toolName: "task_update",
      input: { id: "missing", status: "in_progress" },
      context: context(),
    });

    expect(repeated).toMatchObject({ proceed: false, output: { tasks: canonical, isError: false } });
    expect(policy.prepareStep(stepArgs())).toEqual({ toolChoice: "none" });
  });

  it("detects the reported non-adjacent A-B-A task-state cycle", async () => {
    const policy = new TaskToolPolicy();
    const stateA = [task("one", "completed"), task("two", "completed"), task("three", "pending")];
    const stateB = [task("one", "in_progress"), task("two", "completed"), task("three", "pending")];
    await record(policy, "task_complete", { id: "two" }, stateA);
    await record(policy, "task_update", { id: "one", status: "in_progress" }, stateB);
    await record(policy, "task_complete", { id: "one" }, stateA);

    expect(policy.prepareStep(stepArgs())).toEqual({ toolChoice: "none" });
  });

  it("uses the native terminal check as a text-only latch", async () => {
    const policy = new TaskToolPolicy();
    const tasks = [task("one", "completed")];
    await record(policy, "task_check", {}, tasks, { allCompleted: true });

    expect(policy.prepareStep(stepArgs())).toEqual({ toolChoice: "none" });
    expect(await policy.hooks.beforeToolCall?.({ toolName: "task_check", input: {}, context: context() }))
      .toMatchObject({ proceed: false, output: { isError: false, tasks } });
  });

  it("recognizes a terminal task_check directly from Mastra step results", () => {
    const policy = new TaskToolPolicy();
    const tasks = [task("one", "completed")];
    expect(policy.prepareStep(stepArgs([
      { toolResults: [{ toolName: "task_check", output: { content: "Done", tasks, isError: false, summary: { allCompleted: true } } }] },
    ], "untracked-thread"))).toEqual({ toolChoice: "none" });
  });

  it("keeps forced state isolated by the controller thread id", async () => {
    const policy = new TaskToolPolicy();
    const tasks = [task("one", "completed")];
    await record(policy, "task_check", {}, tasks, { allCompleted: true, threadId: "thread-one" });

    expect(policy.prepareStep(stepArgs([], "thread-one"))).toEqual({ toolChoice: "none" });
    expect(policy.prepareStep(stepArgs([], "thread-two"))).toBeUndefined();
  });

  it("resets its run-local policy state", async () => {
    const policy = new TaskToolPolicy();
    const tasks = [task("one", "completed")];
    await record(policy, "task_check", {}, tasks, { allCompleted: true });
    policy.reset("thread-1");

    expect(policy.prepareStep(stepArgs())).toBeUndefined();
    expect(await policy.hooks.beforeToolCall?.({ toolName: "task_update", input: { id: "one", status: "in_progress" }, context: context() }))
      .toBeUndefined();
  });
});
