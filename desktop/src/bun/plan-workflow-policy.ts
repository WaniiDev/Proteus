import type { AgentControllerMode } from "@mastra/core/agent-controller";
import type { ProcessInputStepArgs, ProcessInputStepResult } from "@mastra/core/processors";

export const PLANNING_MODE_ID = "chat";
export const APPROVED_PLAN_MODE_ID = "approved-plan";

export const PLAN_DRAFT_TOOL_GRANTS = ["read_plan", "write_plan"] as const;

const PLANNING_TOOLS = [
  "ask_user",
  "submit_plan",
  "read_plan",
  "write_plan",
  "task_write",
  "task_update",
  "task_complete",
  "task_check",
] as const;

export const APPROVED_PLAN_TOOLS = [
  "ask_user",
  "read_plan",
  "task_write",
  "task_update",
  "task_complete",
  "task_check",
] as const;

type PlanWorkflowSession = {
  mode: {
    get(): string;
    switch(input: { modeId: string }): Promise<void>;
  };
  model: {
    get(): string;
    switch(input: { modelId: string; scope: "thread"; modeId?: string }): Promise<void>;
    saveForMode(input: { modeId: string; modelId: string }): Promise<void>;
    resolveForMode(input: { modeId: string; defaultModelId?: string }): Promise<string | null>;
  };
};

/** Keep the product's single selected model aligned across Mastra's internal modes. */
export async function syncPlanWorkflowModel(session: PlanWorkflowSession, modelId = session.model.get()): Promise<void> {
  if (!modelId) return;
  const activeModeId = session.mode.get();
  if (session.model.get() !== modelId) await session.model.switch({ modelId, scope: "thread", modeId: activeModeId });
  for (const modeId of [PLANNING_MODE_ID, APPROVED_PLAN_MODE_ID]) {
    if (modeId === activeModeId && session.model.get() === modelId) {
      const persisted = await session.model.resolveForMode({ modeId });
      if (persisted !== modelId) await session.model.saveForMode({ modeId, modelId });
      continue;
    }
    const persisted = await session.model.resolveForMode({ modeId });
    if (persisted !== modelId) await session.model.saveForMode({ modeId, modelId });
  }
}

/** Restore the user-facing conversation mode and let Mastra load its saved model. */
export async function restorePlanningMode(session: PlanWorkflowSession): Promise<void> {
  if (session.mode.get() === APPROVED_PLAN_MODE_ID) await session.mode.switch({ modeId: PLANNING_MODE_ID });
}

export function planWorkflowModes(defaultModelId: string): AgentControllerMode[] {
  return [
    {
      id: PLANNING_MODE_ID,
      name: "Conversation",
      metadata: { default: true },
      defaultModelId,
      transitionsTo: APPROVED_PLAN_MODE_ID,
      instructions: "When a plan is needed, write it once and submit it once for review. Revise and resubmit only after the user explicitly requests changes.",
      availableTools: [...PLANNING_TOOLS],
    },
    {
      id: APPROVED_PLAN_MODE_ID,
      name: "Approved plan",
      defaultModelId,
      instructions: "The user approved the submitted plan. Continue from that approval. Do not write or submit another plan during this resumed turn.",
      availableTools: [...APPROVED_PLAN_TOOLS],
    },
  ];
}

/**
 * Mastra 1.56 transitions the Session mode before a submit_plan resume, but
 * its resumed toolset can still contain the prior mode's tools. Re-apply the
 * native mode allowlist at the documented per-step boundary.
 */
export function approvedPlanPrepareStep(args: ProcessInputStepArgs): ProcessInputStepResult | undefined {
  const controller = args.requestContext?.get("controller") as { session?: { modeId?: unknown } } | undefined;
  return controller?.session?.modeId === APPROVED_PLAN_MODE_ID ? { activeTools: [...APPROVED_PLAN_TOOLS] } : undefined;
}
