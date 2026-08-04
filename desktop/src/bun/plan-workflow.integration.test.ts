import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV2, LanguageModelV2StreamPart } from "@ai-sdk/provider-v5";
import { Agent } from "@mastra/core/agent";
import { AgentController, type AgentControllerEvent } from "@mastra/core/agent-controller";
import { LocalFilesystem, Workspace, WORKSPACE_TOOLS } from "@mastra/core/workspace";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { APPROVED_PLAN_MODE_ID, PLAN_DRAFT_TOOL_GRANTS, PLANNING_MODE_ID, approvedPlanPrepareStep, planWorkflowModes } from "./plan-workflow-policy";

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
        controller.enqueue({ type: "response-metadata", id: "response", modelId: "mock-plan-model", timestamp: new Date(0) });
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  };
}

describe("native Mastra plan approval workflow", () => {
  it("auto-allows the draft, suspends once, changes mode on approval, and cannot submit again", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proteus-plan-workflow-"));
    temporaryDirectories.push(directory);
    const storage = new LibSQLStore({ id: "plan-workflow-storage", url: `file:${join(directory, "workflow.db")}` });
    const memory = new Memory({ storage });
    const events: AgentControllerEvent[] = [];
    const seenTools: string[][] = [];
    let modelStep = 0;
    const scripted = [
      { toolName: "write_plan", input: { path: ".mastracode/plans/placeholder.md", content: "# Placeholder plan\n\n1. Verify approval.", overwrite: true } },
      { toolName: "submit_plan", input: { path: ".mastracode/plans/placeholder.md" } },
    ];
    const model: LanguageModelV2 = {
      specificationVersion: "v2",
      provider: "proteus-test",
      modelId: "mock-plan-model",
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error("This integration exercises streaming only.");
      },
      doStream: async (options) => {
        seenTools.push((options.tools ?? []).map((tool) => tool.name));
        const next = scripted[modelStep++];
        if (next) {
          return modelStream([
            { type: "tool-call", toolCallId: `call-${modelStep}`, toolName: next.toolName, input: JSON.stringify(next.input) },
            { type: "finish", finishReason: "tool-calls", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
          ]);
        }
        return modelStream([
          { type: "text-start", id: "final-text" },
          { type: "text-delta", id: "final-text", delta: "The approved plan is ready." },
          { type: "text-end", id: "final-text" },
          { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
        ]);
      },
    };
    const agent = new Agent({
      id: "plan-workflow-agent",
      name: "Plan workflow agent",
      instructions: "Write and submit one plan.",
      model,
      memory,
      defaultOptions: { prepareStep: approvedPlanPrepareStep },
    });
    const workspace = new Workspace({
      id: "plan-workflow-workspace",
      filesystem: new LocalFilesystem({ basePath: join(directory, "workspace"), contained: true }),
      tools: {
        enabled: false,
        [WORKSPACE_TOOLS.FILESYSTEM.READ_FILE]: { enabled: true, name: "read_plan" },
        [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: { enabled: true, name: "write_plan", requireApproval: false, requireReadBeforeWrite: false },
      },
    });
    const controller = new AgentController({
      id: "plan-workflow-controller",
      resourceId: "plan-workflow-resource",
      storage,
      memory,
      agent,
      workspace,
      defaultModeId: PLANNING_MODE_ID,
      modes: planWorkflowModes("openrouter/auto"),
    });

    try {
      await controller.init();
      const session = await controller.createSession({ id: "plan-workflow-session", resourceId: "plan-workflow-resource" });
      session.subscribe((event) => {
        events.push(event);
      });
      for (const toolName of ["submit_plan", ...PLAN_DRAFT_TOOL_GRANTS]) session.grantTool(toolName);

      await session.sendMessage({ content: "Create a placeholder plan." });
      expect(session.mode.get()).toBe(PLANNING_MODE_ID);
      expect(session.suspensions.has({ toolCallId: "call-2" })).toBe(true);
      expect(events.filter((event) => event.type === "tool_suspended" && event.toolName === "submit_plan")).toHaveLength(1);
      expect(events.some((event) => event.type === "tool_approval_required")).toBe(false);

      const completed = new Promise<void>((resolve) => {
        session.subscribe((event) => {
          if (event.type === "agent_end" && event.reason === "complete") resolve();
        });
      });
      await session.respondToToolSuspension({ toolCallId: "call-2", resumeData: { action: "approved" } });
      await completed;

      expect(session.mode.get()).toBe(APPROVED_PLAN_MODE_ID);
      expect(events.filter((event) => event.type === "mode_changed" && event.modeId === APPROVED_PLAN_MODE_ID)).toHaveLength(1);
      expect(events.filter((event) => event.type === "tool_suspended" && event.toolName === "submit_plan")).toHaveLength(1);
      expect(events.filter((event) => event.type === "tool_end").map((event) => event.toolCallId)).toEqual(["call-1"]);
      expect(seenTools.at(-1)).not.toContain("write_plan");
      expect(seenTools.at(-1)).not.toContain("submit_plan");
    } finally {
      await controller.destroy();
      await storage.close();
    }
  });
});
