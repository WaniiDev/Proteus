import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mastra/core/agent";
import { AgentController } from "@mastra/core/agent-controller";
import { LocalFilesystem, Workspace } from "@mastra/core/workspace";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { APPROVED_PLAN_MODE_ID, PLAN_DRAFT_TOOL_GRANTS, PLANNING_MODE_ID, approvedPlanPrepareStep, planWorkflowModes, restorePlanningMode, syncPlanWorkflowModel } from "./plan-workflow-policy";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
  })));
});

describe("native Mastra plan workflow policy", () => {
  it("transitions approved plans to a mode where planning tools are unavailable", () => {
    const modes = planWorkflowModes("openrouter/auto");
    const planning = modes.find((mode) => mode.id === PLANNING_MODE_ID);
    const approved = modes.find((mode) => mode.id === APPROVED_PLAN_MODE_ID);

    expect(planning?.transitionsTo).toBe(APPROVED_PLAN_MODE_ID);
    expect(planning?.availableTools).toEqual(expect.arrayContaining(["write_plan", "submit_plan"]));
    expect(approved?.availableTools).toContain("read_plan");
    expect(approved?.availableTools).not.toContain("write_plan");
    expect(approved?.availableTools).not.toContain("submit_plan");
  });

  it("re-applies the approved mode allowlist at Mastra's per-step boundary", () => {
    const decision = approvedPlanPrepareStep({
      requestContext: { get: (key: string) => key === "controller" ? { session: { modeId: APPROVED_PLAN_MODE_ID } } : undefined },
    } as never);

    expect(decision?.activeTools).toContain("read_plan");
    expect(decision?.activeTools).not.toContain("write_plan");
    expect(decision?.activeTools).not.toContain("submit_plan");
  });

  it("uses documented Session grants to auto-allow the contained plan draft tools", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proteus-plan-policy-"));
    temporaryDirectories.push(directory);
    const storage = new LibSQLStore({ id: "plan-policy-storage", url: `file:${join(directory, "policy.db")}` });
    const memory = new Memory({ storage });
    const agent = new Agent({
      id: "plan-policy-agent",
      name: "Plan policy agent",
      instructions: "Contract test only.",
      model: "openrouter/auto",
      memory,
    });
    const workspace = new Workspace({
      id: "plan-policy-workspace",
      filesystem: new LocalFilesystem({ basePath: join(directory, "workspace"), contained: true }),
      tools: { enabled: false },
    });
    const controller = new AgentController({
      id: "plan-policy-controller",
      resourceId: "plan-policy-resource",
      storage,
      memory,
      agent,
      workspace,
      defaultModeId: PLANNING_MODE_ID,
      modes: planWorkflowModes("openrouter/auto"),
    });

    try {
      await controller.init();
      const session = await controller.createSession({ id: "plan-policy-session", resourceId: "plan-policy-resource" });
      expect(session.resolveToolApproval("write_plan")).toBe("ask");
      for (const toolName of PLAN_DRAFT_TOOL_GRANTS) session.grantTool(toolName);
      expect(session.resolveToolApproval("read_plan")).toBe("allow");
      expect(session.resolveToolApproval("write_plan")).toBe("allow");
    } finally {
      await controller.destroy();
      await storage.close();
    }
  });

  it("persists one selected model across Mastra's internal plan modes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proteus-plan-model-"));
    temporaryDirectories.push(directory);
    const storage = new LibSQLStore({ id: "plan-model-storage", url: `file:${join(directory, "model.db")}` });
    const memory = new Memory({ storage });
    const workspace = new Workspace({
      id: "plan-model-workspace",
      filesystem: new LocalFilesystem({ basePath: join(directory, "workspace"), contained: true }),
      tools: { enabled: false },
    });
    const controller = new AgentController({
      id: "plan-model-controller",
      resourceId: "plan-model-resource",
      storage,
      memory,
      workspace,
      agent: new Agent({ id: "plan-model-agent", name: "Plan model agent", instructions: "Contract test only.", model: "openrouter/auto", memory }),
      defaultModeId: PLANNING_MODE_ID,
      modes: planWorkflowModes("openrouter/auto"),
    });

    try {
      await controller.init();
      const session = await controller.createSession({ id: "plan-model-session", resourceId: "plan-model-resource" });
      await syncPlanWorkflowModel(session, "openrouter/openai/test-model");
      expect(session.model.get()).toBe("openrouter/openai/test-model");
      await session.mode.switch({ modeId: APPROVED_PLAN_MODE_ID });
      expect(session.model.get()).toBe("openrouter/openai/test-model");
      await restorePlanningMode(session);
      expect(session.mode.get()).toBe(PLANNING_MODE_ID);
      expect(session.model.get()).toBe("openrouter/openai/test-model");
    } finally {
      await controller.destroy();
      await storage.close();
    }
  });
});
