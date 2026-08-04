import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV2, LanguageModelV2StreamPart } from "@ai-sdk/provider-v5";
import { Agent } from "@mastra/core/agent";
import { AgentController, type AgentControllerEvent } from "@mastra/core/agent-controller";
import { TaskSignalProvider } from "@mastra/core/signals";
import { LocalFilesystem, Workspace } from "@mastra/core/workspace";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { historicalTaskToolOutcomes } from "./runtime-projection";
import { TaskToolPolicy } from "./task-tool-policy";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
  })));
});

function modelStream(parts: LanguageModelV2StreamPart[]) {
  return {
    rawCall: { rawPrompt: null, rawSettings: {} },
    warnings: [],
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "response-metadata", id: "response", modelId: "mock-task-model", timestamp: new Date(0) });
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  };
}

describe("native Mastra task workflow", () => {
  it("runs the exact task-only flow, checks once, then produces a text-only final step", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proteus-task-workflow-"));
    temporaryDirectories.push(directory);
    const storage = new LibSQLStore({ id: "task-workflow-storage", url: `file:${join(directory, "workflow.db")}` });
    const memory = new Memory({ storage });
    const policy = new TaskToolPolicy();
    const hookOutputs: Array<{ toolName: string; output: unknown }> = [];
    const prepareDecisions: unknown[] = [];
    const scripted = [
      { toolName: "task_write", input: { tasks: [{ id: "demo", content: "Complete the demonstration", status: "pending", activeForm: "Completing the demonstration" }] } },
      { toolName: "task_update", input: { id: "demo", status: "in_progress" } },
      { toolName: "task_complete", input: { id: "demo" } },
      { toolName: "task_check", input: {} },
    ];
    let modelStep = 0;
    const seenToolChoices: unknown[] = [];
    const model: LanguageModelV2 = {
      specificationVersion: "v2",
      provider: "proteus-test",
      modelId: "mock-task-model",
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error("This integration exercises streaming only.");
      },
      doStream: async (options) => {
        seenToolChoices.push(options.toolChoice);
        const next = scripted[modelStep++];
        if (next) {
          const toolCallId = `call-${modelStep}`;
          return modelStream([
            { type: "tool-call", toolCallId, toolName: next.toolName, input: JSON.stringify(next.input) },
            { type: "finish", finishReason: "tool-calls", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
          ]);
        }
        return modelStream([
          { type: "text-start", id: "final-text" },
          { type: "text-delta", id: "final-text", delta: "All tasks are complete." },
          { type: "text-end", id: "final-text" },
          { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
        ]);
      },
    };
    const agent = new Agent({
      id: "task-workflow-agent",
      name: "Task workflow agent",
      instructions: "Use only task tools, finish tasks one by one, check once, then answer.",
      model,
      memory,
      signals: [new TaskSignalProvider()],
      hooks: {
        beforeToolCall: policy.hooks.beforeToolCall,
        afterToolCall: async (args) => {
          hookOutputs.push({ toolName: args.toolName, output: args.output });
          await policy.hooks.afterToolCall?.(args);
        },
      },
      defaultOptions: {
        prepareStep: (args) => {
          const decision = policy.prepareStep(args);
          prepareDecisions.push(decision);
          return decision;
        },
      },
    });
    const workspace = new Workspace({
      id: "task-workflow-workspace",
      filesystem: new LocalFilesystem({ basePath: join(directory, "workspace"), contained: true }),
      tools: { enabled: false },
    });
    const controller = new AgentController({
      id: "task-workflow-controller",
      resourceId: "task-workflow-resource",
      storage,
      memory,
      agent,
      workspace,
      modes: [{ id: "chat", name: "Chat", metadata: { default: true }, availableTools: ["task_write", "task_update", "task_complete", "task_check"] }],
    });
    const events: AgentControllerEvent[] = [];

    try {
      await controller.init();
      const session = await controller.createSession({ id: "task-workflow-session", resourceId: "task-workflow-resource" });
      session.subscribe((event) => {
        events.push(event);
      });
      for (const toolName of ["task_write", "task_update", "task_complete", "task_check"]) session.grantTool(toolName);

      await session.sendMessage({ content: "Create task using task tools and finish one by one without creating any plan using only task tools" });

      const endedTools = events.filter((event): event is Extract<AgentControllerEvent, { type: "tool_end" }> => event.type === "tool_end");
      expect(endedTools.map((event) => event.toolCallId)).toEqual(["call-1", "call-2", "call-3", "call-4"]);
      expect(endedTools.filter((event) => event.toolCallId === "call-4")).toHaveLength(1);
      expect(hookOutputs.map(({ toolName }) => toolName)).toEqual(["task_write", "task_update", "task_complete", "task_check"]);
      expect(hookOutputs.at(-1)?.output).toMatchObject({ isError: false, summary: { allCompleted: true } });
      expect(prepareDecisions.at(-1)).toEqual({ toolChoice: "none" });
      expect(seenToolChoices).toHaveLength(5);
      expect(seenToolChoices[4]).toEqual({ type: "none" });
      expect(events.some((event) => event.type === "agent_end" && event.reason === "complete")).toBe(true);
      expect(session.displayState.get().tasks).toEqual([
        { id: "demo", content: "Complete the demonstration", status: "completed", activeForm: "Completing the demonstration" },
      ]);
      const threadId = session.thread.requireId();
      const persisted = await session.thread.listMessages({ threadId });
      const historicalOutcomes = historicalTaskToolOutcomes(persisted);
      expect(["call-1", "call-2", "call-3", "call-4"].map((toolCallId) => historicalOutcomes.get(toolCallId)?.status)).toEqual([
        "completed", "completed", "completed", "completed",
      ]);
    } finally {
      await controller.destroy();
      await storage.close();
    }
  });
});
