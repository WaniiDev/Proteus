import { describe, expect, it } from "bun:test";
import type { ProcessInputStepArgs, ProcessOutputStepArgs } from "@mastra/core/processors";
import type { TaskItem } from "@mastra/core/signals";
import { assessTaskToolCalls, TASK_LOOP_STEP_LIMIT, TaskLoopGuardProcessor, taskListFingerprint } from "./task-loop-guard";

const tasks: TaskItem[] = [
  { id: "define_features", content: "Define the features", activeForm: "Defining the features", status: "completed" },
  { id: "design_interface", content: "Design the interface", activeForm: "Designing the interface", status: "in_progress" },
  { id: "define_tests", content: "Define the tests", activeForm: "Defining the tests", status: "pending" },
];

describe("task tool call assessment", () => {
  it("allows the normal transition to the next task", () => {
    expect(assessTaskToolCalls([{ toolName: "task_complete", args: { id: "design_interface" } }], tasks)).toEqual({ allowed: true });
    expect(assessTaskToolCalls([{ toolName: "task_update", args: { id: "define_tests", status: "in_progress" } }], tasks)).toEqual({ allowed: true });
  });

  it("rejects repeated or missing task mutations", () => {
    expect(assessTaskToolCalls([{ toolName: "task_complete", args: { id: "define_features" } }], tasks)).toMatchObject({ allowed: false, taskId: "define_features" });
    expect(assessTaskToolCalls([{ toolName: "task_update", args: { id: "design_interface", status: "in_progress" } }], tasks)).toMatchObject({ allowed: false, taskId: "design_interface" });
    expect(assessTaskToolCalls([{ toolName: "task_complete", args: { id: "missing" } }], tasks)).toMatchObject({ allowed: false, taskId: "missing" });
  });

  it("rejects an identical full-list write and concurrent task calls", () => {
    expect(assessTaskToolCalls([{ toolName: "task_write", args: { tasks } }], tasks)).toMatchObject({ allowed: false, toolName: "task_write" });
    expect(assessTaskToolCalls([
      { toolName: "task_complete", args: { id: "design_interface" } },
      { toolName: "task_update", args: { id: "define_tests", status: "in_progress" } },
    ], tasks)).toMatchObject({ allowed: false });
  });

  it("allows one task check per unchanged snapshot", () => {
    const first = assessTaskToolCalls([{ toolName: "task_check", args: {} }], tasks);
    expect(first).toEqual({ allowed: true, checkFingerprint: taskListFingerprint(tasks) });
    expect(assessTaskToolCalls([{ toolName: "task_check", args: {} }], tasks, taskListFingerprint(tasks))).toMatchObject({ allowed: false, toolName: "task_check" });
  });
});

describe("TaskLoopGuardProcessor", () => {
  const outputArgs = (state: Record<string, unknown>, retryCount = 0): ProcessOutputStepArgs => ({
    stepNumber: 2,
    steps: [],
    messages: [],
    messageList: {} as ProcessOutputStepArgs["messageList"],
    systemMessages: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    state,
    retryCount,
    toolCalls: [{ toolName: "task_complete", toolCallId: `call-${retryCount}`, args: { id: "define_features" } }],
    abort: ((reason?: string, options?: unknown) => {
      throw { reason, options };
    }) as ProcessOutputStepArgs["abort"],
  });

  it("retries one no-op and forces text after the second violation", async () => {
    const state: Record<string, unknown> = {};
    const processor = new TaskLoopGuardProcessor(async () => tasks);

    await expect(processor.processOutputStep(outputArgs(state))).rejects.toMatchObject({ options: { retry: true } });
    expect(state).toMatchObject({ consecutiveViolations: 1 });
    await expect(processor.processOutputStep(outputArgs(state, 1))).rejects.toMatchObject({ options: { retry: true } });
    expect(state).toMatchObject({ consecutiveViolations: 2, forceTextResponse: true });

    const input = processor.processInputStep({ stepNumber: 3, state, systemMessages: [] } as unknown as ProcessInputStepArgs);
    expect(input).toMatchObject({ toolChoice: "none" });
    expect(state).toMatchObject({ consecutiveViolations: 0, forceTextResponse: false });
  });

  it("forces a normal text response at the local step ceiling", () => {
    const processor = new TaskLoopGuardProcessor(async () => tasks);
    const input = processor.processInputStep({ stepNumber: TASK_LOOP_STEP_LIMIT, state: {}, systemMessages: [] } as unknown as ProcessInputStepArgs);
    expect(input).toMatchObject({ toolChoice: "none" });
  });
});
