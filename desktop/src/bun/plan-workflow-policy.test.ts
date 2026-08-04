import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mastra/core/agent";
import { AgentController } from "@mastra/core/agent-controller";
import { LocalFilesystem, Workspace } from "@mastra/core/workspace";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { APPROVED_PLAN_MODE_ID, PLAN_DRAFT_TOOL_GRANTS, PLANNING_MODE_ID, planWorkflowModes } from "./plan-workflow-policy";

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
});
