import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { TaskSignalProvider } from "@mastra/core/signals";
import { submitPlanTool, TASK_STATE_TYPE, type TaskItemSnapshot } from "@mastra/core/tools";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { scriptedStreamingModel, waitFor } from "./native-mastra-test-harness";
import { APPROVED_PLAN_TOOLS } from "./plan-workflow-policy";
import { NativeToolCallGuard } from "./native-tool-call-guard";

const temporaryDirectories: string[] = [];
const mastraInstances: Mastra[] = [];

afterEach(async () => {
  await Promise.all(mastraInstances.splice(0).map((mastra) => mastra.shutdown()));
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
  })));
});

async function storageFixture(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), `${prefix}-`));
  temporaryDirectories.push(directory);
  const storage = new LibSQLStore({ id: `${prefix}-${crypto.randomUUID()}`, url: `file:${join(directory, "mastra.db")}` });
  const memory = new Memory({ storage });
  return { storage, memory };
}

describe("native Mastra 1.56 contracts", () => {
  it("discovers and resumes submit_plan through native persisted suspension APIs", async () => {
    const { storage, memory } = await storageFixture("native-plan-contract");
    const requests: string[][] = [];
    const agent = new Agent({
      id: `native-plan-agent-${crypto.randomUUID()}`,
      name: "Native plan contract agent",
      instructions: "Submit the requested plan once, then report the approval result.",
      model: scriptedStreamingModel([
        { type: "tool", toolName: "submit_plan", input: { path: ".mastracode/plans/native-contract.md" } },
        { type: "text", text: "The plan was approved." },
      ], ({ toolNames }) => requests.push(toolNames)),
      memory,
      tools: { submit_plan: submitPlanTool },
    });
    const mastra = new Mastra({ storage, agents: { contract: agent }, logger: false });
    mastraInstances.push(mastra);
    const resourceId = "native-contract-user";
    const threadId = `thread-${crypto.randomUUID()}`;
    const chunks: Array<{ type: string; payload?: unknown }> = [];
    const subscription = await agent.subscribeToThread({ resourceId, threadId });
    void (async () => {
      for await (const chunk of subscription.stream) chunks.push(chunk as { type: string; payload?: unknown });
    })();

    const clientMessageId = `client-${crypto.randomUUID()}`;
    const queued = agent.queueMessage({ contents: "Create the contract plan.", metadata: { clientMessageId } }, { resourceId, threadId });
    const accepted = await queued.accepted;
    expect(accepted.action).toBe("wake");
    if (accepted.action === "wake") void accepted.output.consumeStream();

    const suspendedChunk = await waitFor("native plan suspension", () => chunks.find((chunk) => chunk.type === "tool-call-suspended"));
    expect(suspendedChunk.type).toBe("tool-call-suspended");
    const persistedSignal = (await memory.recall({ threadId, perPage: false })).messages.find((message) => message.id === queued.signal.id);
    expect(persistedSignal?.role).toBe("signal");
    expect((persistedSignal?.content.metadata as { signal?: { metadata?: { clientMessageId?: string } } } | undefined)?.signal?.metadata?.clientMessageId).toBe(clientMessageId);
    const suspended = await agent.listSuspendedRuns({ resourceId, threadId });
    expect(suspended.runs).toHaveLength(1);
    const run = suspended.runs[0];
    const toolCall = run.toolCalls[0];
    expect(toolCall.toolName).toBe("submit_plan");
    expect(toolCall.requiresApproval).toBeFalse();

    await agent.sendStreamResume({
      resourceId,
      threadId,
      runId: run.runId,
      toolCallId: toolCall.toolCallId,
      resumeData: { action: "approved", path: ".mastracode/plans/native-contract.md" },
      streamOptions: { activeTools: [] },
    });
    await waitFor("resumed native plan completion", () => chunks.find((chunk) => chunk.type === "finish"));
    expect(requests[0]).toContain("submit_plan");
    expect(requests.at(-1)).not.toContain("submit_plan");
    expect((await agent.listSuspendedRuns({ resourceId, threadId })).runs).toHaveLength(0);
    subscription.unsubscribe();
  });

  it("persists TaskSignalProvider state in the native threadState domain", async () => {
    const { storage, memory } = await storageFixture("native-task-contract");
    const tasks = [
      { id: "task_one", content: "Complete task one", activeForm: "Completing task one", status: "pending" },
    ];
    const agent = new Agent({
      id: `native-task-agent-${crypto.randomUUID()}`,
      name: "Native task contract agent",
      instructions: "Use the task tools in order.",
      model: scriptedStreamingModel([
        { type: "tool", toolName: "task_write", input: { tasks } },
        { type: "tool", toolName: "task_complete", input: { id: "task_one" } },
        { type: "tool", toolName: "task_check", input: {} },
        { type: "text", text: "All tasks are complete." },
      ]),
      memory,
      signals: [new TaskSignalProvider()],
    });
    const mastra = new Mastra({ storage, agents: { contract: agent }, logger: false });
    mastraInstances.push(mastra);
    const resourceId = "native-contract-user";
    const threadId = `thread-${crypto.randomUUID()}`;
    const subscription = await agent.subscribeToThread({ resourceId, threadId });
    const chunks: Array<{ type: string }> = [];
    void (async () => {
      for await (const chunk of subscription.stream) chunks.push(chunk as { type: string });
    })();
    const queued = agent.queueMessage("Track and complete one task.", { resourceId, threadId });
    const accepted = await queued.accepted;
    expect(accepted.action).toBe("wake");
    if (accepted.action === "wake") void accepted.output.consumeStream();
    await waitFor("native task completion", () => chunks.find((chunk) => chunk.type === "finish"));

    const threadState = await storage.getStore("threadState");
    const stored = await threadState?.getState<TaskItemSnapshot[]>({ threadId, type: TASK_STATE_TYPE });
    expect(stored).toEqual([{ ...tasks[0], status: "completed" }]);
    subscription.unsubscribe();
  });

  it("exposes task tools on a fresh turn after manually approving a plan", async () => {
    const { storage, memory } = await storageFixture("native-plan-task-contract");
    const requests: string[][] = [];
    const tasks = [
      { id: "task_after_plan", content: "Start work after approval", activeForm: "Starting work after approval", status: "pending" },
    ];
    const agent = new Agent({
      id: `native-plan-task-agent-${crypto.randomUUID()}`,
      name: "Native plan then task contract agent",
      instructions: "Submit a plan, accept the explicit UI resume, then use task tools when asked in a later turn.",
      model: scriptedStreamingModel([
        { type: "tool", toolName: "submit_plan", input: { path: ".mastracode/plans/native-plan-task-contract.md" } },
        { type: "text", text: "The plan was approved." },
        { type: "tool", toolName: "task_write", input: { tasks } },
        { type: "text", text: "The task list is ready." },
      ], ({ toolNames }) => requests.push(toolNames)),
      memory,
      tools: { submit_plan: submitPlanTool },
      signals: [new TaskSignalProvider()],
      defaultOptions: { autoResumeSuspendedTools: false },
    });
    const mastra = new Mastra({ storage, agents: { contract: agent }, logger: false });
    mastraInstances.push(mastra);
    const resourceId = "native-contract-user";
    const threadId = `thread-${crypto.randomUUID()}`;
    const chunks: Array<{ type: string }> = [];
    const subscription = await agent.subscribeToThread({ resourceId, threadId });
    void (async () => {
      for await (const chunk of subscription.stream) chunks.push(chunk as { type: string });
    })();

    const planned = agent.queueMessage("Create a plan.", { resourceId, threadId });
    const plannedAccepted = await planned.accepted;
    expect(plannedAccepted.action).toBe("wake");
    if (plannedAccepted.action === "wake") void plannedAccepted.output.consumeStream();
    await waitFor("plan suspension before task turn", () => chunks.find((chunk) => chunk.type === "tool-call-suspended"));
    const [suspendedRun] = (await agent.listSuspendedRuns({ resourceId, threadId })).runs;
    const [suspendedTool] = suspendedRun.toolCalls;
    await agent.sendStreamResume({
      resourceId,
      threadId,
      runId: suspendedRun.runId,
      toolCallId: suspendedTool.toolCallId,
      resumeData: { action: "approved", path: ".mastracode/plans/native-plan-task-contract.md" },
      streamOptions: { activeTools: [...APPROVED_PLAN_TOOLS] },
    });
    await waitFor("manual approval continuation", () => chunks.filter((chunk) => chunk.type === "finish").length >= 1 ? true : undefined);

    const tasked = agent.queueMessage("Use task tools now.", { resourceId, threadId });
    const taskedAccepted = await tasked.accepted;
    expect(taskedAccepted.action).toBe("wake");
    if (taskedAccepted.action === "wake") void taskedAccepted.output.consumeStream();
    await waitFor("fresh task turn completion", () => chunks.filter((chunk) => chunk.type === "finish").length >= 2 ? true : undefined);

    expect(requests[0]).toContain("submit_plan");
    expect(requests[1]).toContain("task_write");
    expect(requests[1]).not.toContain("submit_plan");
    expect(requests[2]).toContain("task_write");
    expect(requests[2]).toContain("submit_plan");
    subscription.unsubscribe();
  });

  it("retries a textual imitation using Mastra's current native tool catalog", async () => {
    const { storage, memory } = await storageFixture("native-tool-integrity-contract");
    const requests: string[][] = [];
    const tasks: TaskItemSnapshot[] = [
      { id: "native_retry", content: "Recover with a native task call", activeForm: "Recovering with a native task call", status: "pending" },
    ];
    const guard = new NativeToolCallGuard();
    const agent = new Agent({
      id: `native-tool-integrity-agent-${crypto.randomUUID()}`,
      name: "Native tool integrity contract agent",
      instructions: "Use the native task tool.",
      model: scriptedStreamingModel([
        { type: "text", text: `to=task_write (json ${JSON.stringify({ tasks })})` },
        { type: "tool", toolName: "task_write", input: { tasks } },
        { type: "text", text: "The native task call succeeded." },
      ], ({ toolNames }) => requests.push(toolNames)),
      memory,
      signals: [new TaskSignalProvider()],
      inputProcessors: [guard],
      outputProcessors: [guard],
      maxProcessorRetries: 1,
    });
    const mastra = new Mastra({ storage, agents: { contract: agent }, logger: false });
    mastraInstances.push(mastra);
    const resourceId = "native-contract-user";
    const threadId = `thread-${crypto.randomUUID()}`;
    const chunks: Array<{ type: string }> = [];
    const subscription = await agent.subscribeToThread({ resourceId, threadId });
    void (async () => {
      for await (const chunk of subscription.stream) chunks.push(chunk as { type: string });
    })();

    const queued = agent.queueMessage("Create the task with the native tool.", { resourceId, threadId });
    const accepted = await queued.accepted;
    expect(accepted.action).toBe("wake");
    if (accepted.action === "wake") void accepted.output.consumeStream();
    await waitFor("tool-integrity retry completion", () => chunks.find((chunk) => chunk.type === "finish"));

    expect(requests).toHaveLength(3);
    expect(requests.every((toolNames) => toolNames.includes("task_write"))).toBeTrue();
    const threadState = await storage.getStore("threadState");
    expect(await threadState?.getState<TaskItemSnapshot[]>({ threadId, type: TASK_STATE_TYPE })).toEqual(tasks);
    expect(JSON.stringify((await memory.recall({ threadId, perPage: false })).messages)).not.toContain("to=task_write");
    subscription.unsubscribe();
  });
});
