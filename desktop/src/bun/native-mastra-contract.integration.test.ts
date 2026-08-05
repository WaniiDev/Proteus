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

    const queued = agent.queueMessage("Create the contract plan.", { resourceId, threadId });
    const accepted = await queued.accepted;
    expect(accepted.action).toBe("wake");
    if (accepted.action === "wake") void accepted.output.consumeStream();

    const suspendedChunk = await waitFor("native plan suspension", () => chunks.find((chunk) => chunk.type === "tool-call-suspended"));
    expect(suspendedChunk.type).toBe("tool-call-suspended");
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
});
