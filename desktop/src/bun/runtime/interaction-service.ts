import { isAbsolute, normalize } from "node:path";
import { LocalFilesystem } from "@mastra/core/workspace";
import type { InteractionError, InteractionResponseResult, PendingInteraction } from "../../shared/contracts";
import { upsertPendingInteraction, parseSuspendedInteraction, submitPlanResolutionResult } from "../core/runtime-projection";
import { APPROVED_PLAN_TOOLS } from "../plan-workflow-policy";
import { RuntimeDiagnostics } from "../core/diagnostics";
import { approvalFingerprint } from "../approval-policy";
import { NativeAgentDriver } from "../native/native-agent-driver";
import { resolveAskUserResponse } from "../ask-user-response";
import { MASTRA_TOOL_DECLINED_MESSAGE } from "../tool-decision";
import type { InteractionResolution } from "./types";
import { normalizeError } from "../core/runtime-error-mapping";
import type { RuntimeContext } from "./context";
import type { MessageProjector } from "./message-projector";
import type { ThreadService } from "./thread-service";
import type { ContinuationService } from "./continuation-service";
import type { WorkspaceService } from "./workspace-service";

/** ask_user, plan and tool-approval responses and their resolving/failed bookkeeping. */
export class InteractionService {
  readonly hydratingPlans = new Set<string>();
  readonly hydratedPlans = new Set<string>();
  private readonly nativeDriver: NativeAgentDriver;
  private readonly diagnostics: RuntimeDiagnostics;
  private readonly planFilesystem: LocalFilesystem;
  private readonly threads: ThreadService;
  private readonly workspaces: WorkspaceService;
  private readonly continuation: ContinuationService;
  private readonly projector: MessageProjector;

  constructor(private readonly ctx: RuntimeContext, deps: { nativeDriver: NativeAgentDriver; diagnostics: RuntimeDiagnostics; planFilesystem: LocalFilesystem; threads: ThreadService; workspaces: WorkspaceService; continuation: ContinuationService; projector: MessageProjector }) {
    this.nativeDriver = deps.nativeDriver;
    this.diagnostics = deps.diagnostics;
    this.planFilesystem = deps.planFilesystem;
    this.threads = deps.threads;
    this.workspaces = deps.workspaces;
    this.continuation = deps.continuation;
    this.projector = deps.projector;
  }

  async hydratePlanSuspension(threadId: string, toolCallId: string, pathValue: unknown, originMessageId?: string): Promise<void> {
    if (typeof pathValue !== "string" || this.hydratingPlans.has(toolCallId) || this.hydratedPlans.has(toolCallId)) return;
    this.hydratingPlans.add(toolCallId);
    try {
      const path = normalize(pathValue.trim()).replaceAll("\\", "/");
      if (!path || isAbsolute(pathValue) || path === ".." || path.startsWith("../") || !path.toLowerCase().endsWith(".md")) throw new Error("Plan path must be a relative Markdown file.");
      if (!this.planFilesystem.resolveAbsolutePath(path)) throw new Error("Plan path is outside the contained workspace.");
      const content = await this.planFilesystem.readFile(path);
      const plan = typeof content === "string" ? content : content.toString("utf8");
      if (!plan.trim()) throw new Error("Plan file is empty.");
      if (Buffer.byteLength(plan, "utf8") > 128 * 1024) throw new Error("Plan file is larger than 128 KiB.");
      const previous = this.threads.stateFor(threadId).pendingInteractions?.find((item) => item.toolCallId === toolCallId);
      const interaction = parseSuspendedInteraction(
        { toolCallId, toolName: "submit_plan", suspendPayload: { path, plan } },
        previous?.plan?.version ?? this.threads.nextPlanVersion(threadId),
        originMessageId,
      );
      if (!interaction) throw new Error("Plan suspension could not be parsed.");
      const next = this.threads.updateThreadState(threadId, (state) => ({
        ...state,
        pendingInteractions: upsertPendingInteraction(state.pendingInteractions ?? [], interaction),
      }));
      this.hydratedPlans.add(toolCallId);
      await this.threads.persistThreadState(threadId, next);
      if (this.ctx.selectedThreadId === threadId) {
        const current = this.threads.stateFor(threadId);
        this.ctx.publish({ interactions: current.pendingInteractions ?? [], workbench: this.threads.workbenchFromState(current, null) });
      }
    } catch (error) {
      this.markInteractionFailed(threadId, toolCallId, {
        code: "resume-failed",
        message: error instanceof Error ? error.message : "The submitted plan file could not be read.",
        retryable: Boolean(originMessageId),
      });
    } finally {
      this.hydratingPlans.delete(toolCallId);
    }
  }

  private resolvedInteraction(entry: InteractionResolution, terminalStatus: PendingInteraction["status"] = entry.status, feedback?: string): PendingInteraction {
    const plan = entry.interaction.plan;
    const planStatus = terminalStatus === "approved" ? "approved" : terminalStatus === "rejected" ? "rejected" : terminalStatus === "cancelled" ? "draft" : entry.status === "approved" ? "approved" : entry.status === "rejected" ? "rejected" : plan?.status;
    return {
      ...entry.interaction,
      status: terminalStatus,
      ...(plan
        ? {
            plan: {
              ...plan,
              ...(planStatus ? { status: planStatus } : {}),
              ...(feedback || entry.feedback ? { feedback: feedback || entry.feedback } : {}),
            },
          }
        : {}),
    };
  }

  private finalizeResolvingInteractions(threadId: string, toolCallId?: string, terminalStatus?: PendingInteraction["status"], feedback?: string): void {
    const entries = [...this.ctx.resolvingInteractions.entries()].filter(([id]) => !toolCallId || id === toolCallId);
    if (entries.length === 0) return;
    const resolved = entries.map(([, entry]) => this.resolvedInteraction(entry, terminalStatus ?? entry.status, feedback));
    const resolvedIds = new Set(entries.map(([id]) => id));
    for (const id of resolvedIds) this.ctx.resolvingInteractions.delete(id);
    for (const id of resolvedIds) this.hydratedPlans.delete(id);
    const next = this.threads.updateThreadState(threadId, (state) => ({
      ...state,
      pendingInteractions: (state.pendingInteractions ?? []).filter((item) => !resolvedIds.has(item.toolCallId)),
      resolvedInteractions: [...(state.resolvedInteractions ?? []), ...resolved],
    }));
    void this.threads.persistThreadState(threadId, next);
    if (this.ctx.selectedThreadId === threadId) {
      this.ctx.publish({
        interactions: next.pendingInteractions ?? [],
        workbench: this.threads.workbenchFromState(next, null),
      });
    }
  }

  private markInteractionFailed(threadId: string, toolCallId: string, error: InteractionError): void {
    this.ctx.resolvingInteractions.delete(toolCallId);
    this.hydratedPlans.delete(toolCallId);
    const next = this.threads.updateThreadState(threadId, (state) => ({
      ...state,
      pendingInteractions: (state.pendingInteractions ?? []).map((item) =>
        item.toolCallId === toolCallId ? { ...item, status: "failed", error } : item,
      ),
    }));
    void this.threads.persistThreadState(threadId, next);
    if (this.ctx.selectedThreadId === threadId) {
      this.ctx.publish({
        interactions: next.pendingInteractions ?? [],
        workbench: this.threads.workbenchFromState(next, null),
      });
    }
  }

  private interactionFailure(error: InteractionError): InteractionResponseResult {
    return { accepted: false, ...error };
  }

  async respondToInteraction(toolCallId: string, response: unknown): Promise<InteractionResponseResult> {
    const requestStartedAt = performance.now();
    await this.ctx.ensureInitialized();
    const threadId = this.ctx.selectedThreadId;
    const interaction = this.ctx.threadState.pendingInteractions?.find((item) => item.toolCallId === toolCallId);
    if (!threadId || !interaction) return this.interactionFailure({ code: "stale", message: "That request is no longer waiting for an answer.", retryable: false });
    this.diagnostics.record({ source: "runtime", type: "interaction_response", phase: "received", threadId, runId: interaction.runId, toolCallId, payload: { kind: interaction.kind } });
    if (interaction.status !== "pending") return this.interactionFailure({ code: "busy", message: "That request is already being resolved.", retryable: interaction.status === "failed" });
    if (this.ctx.resolvingInteractions.size > 0) return this.interactionFailure({ code: "busy", message: "Another response is already being resolved.", retryable: true });
    const nativeSuspension = await this.nativeDriver.findSuspension(threadId, toolCallId);
    if (!nativeSuspension) return this.interactionFailure({ code: "stale", message: "This approval expired. Resubmit the original turn to try again.", retryable: Boolean(interaction.originMessageId) });
    let resumeData: unknown;
    let nextStatus: Extract<PendingInteraction["status"], "approved" | "rejected" | "answered">;
    let feedback: string | undefined;
    if (interaction.kind === "submit_plan") {
      if (!response || typeof response !== "object") return this.interactionFailure({ code: "invalid-response", message: "Plan approval response is invalid.", retryable: true });
      const record = response as { action?: unknown; feedback?: unknown };
      if (record.action !== "approved" && record.action !== "rejected") return this.interactionFailure({ code: "invalid-response", message: "Choose approve or request changes.", retryable: true });
      feedback = typeof record.feedback === "string" && record.feedback.trim() ? record.feedback.trim() : undefined;
      resumeData = {
        action: record.action,
        ...(feedback ? { feedback } : {}),
        ...(interaction.plan?.sourcePath ? { path: interaction.plan.sourcePath } : {}),
        ...(interaction.title ? { title: interaction.title } : {}),
        ...(interaction.plan?.raw ? { plan: interaction.plan.raw } : {}),
      };
      nextStatus = record.action === "approved" ? "approved" : "rejected";
    } else {
      const answer = resolveAskUserResponse(interaction, response);
      if (!answer.accepted) return this.interactionFailure({ code: "invalid-response", message: answer.message, retryable: true });
      resumeData = answer.resumeData;
      nextStatus = "answered";
    }
    const resolving = { ...interaction, status: "resolving" as const };
    const resolution: InteractionResolution = {
      interaction,
      status: nextStatus,
      feedback,
    };
    this.ctx.resolvingInteractions.set(toolCallId, resolution);
    const resolvingState = this.threads.updateThreadState(threadId, (state) => ({
      ...state,
      pendingInteractions: (state.pendingInteractions ?? []).map((item) => (item.toolCallId === toolCallId ? resolving : item)),
    }));
    if (this.ctx.selectedThreadId === threadId) {
      this.ctx.publish({
        interactions: resolvingState.pendingInteractions ?? [],
        workbench: this.threads.workbenchFromState(resolvingState, null),
      });
    }
    this.diagnostics.record({ source: "runtime", type: "interaction_response", phase: "ui_resolving", threadId, runId: this.ctx.runId, toolCallId, durationMs: performance.now() - requestStartedAt });
    return await this.completeInteractionResponse(threadId, toolCallId, resumeData, interaction, nextStatus, feedback);
  }

  private async completeInteractionResponse(threadId: string, toolCallId: string, resumeData: unknown, interaction: PendingInteraction, nextStatus: Extract<PendingInteraction["status"], "approved" | "rejected" | "answered">, feedback?: string): Promise<InteractionResponseResult> {
    try {
      const nativeSuspension = await this.nativeDriver.findSuspension(threadId, toolCallId);
      if (!nativeSuspension) throw new Error("Mastra no longer has this suspended run.");
      if (interaction.runId && nativeSuspension.runId !== interaction.runId) throw new Error("The suspended run changed before this response was accepted.");
      if (nativeSuspension.requiresApproval) throw new Error("This response belongs to an approval request, not a suspended interaction.");
      const resumeStartedAt = performance.now();
      const approvedPlan = interaction.kind === "submit_plan" && nextStatus === "approved";
      await this.nativeDriver.resume(threadId, nativeSuspension.runId, toolCallId, resumeData, {
        requestContext: await this.workspaces.requestContextFor(threadId),
        ...(approvedPlan ? { activeTools: [...APPROVED_PLAN_TOOLS] } : {}),
      });
      this.ctx.nativeSuspensions.delete(toolCallId);
      if (interaction.kind === "submit_plan") {
        this.projector.recordToolOutcome(toolCallId, submitPlanResolutionResult(nextStatus === "approved" ? "approved" : "rejected", feedback), false, nextStatus === "approved" ? "completed" : "declined");
      } else {
        this.projector.recordToolOutcome(toolCallId, { content: "Response received" }, false, "completed");
      }
      this.finalizeResolvingInteractions(threadId, toolCallId);
      await this.continuation.beginContinuation(threadId, interaction, nativeSuspension.runId, interaction.kind === "submit_plan" ? nextStatus === "approved" ? "plan-approved" : "plan-rejected" : "answered");
      this.diagnostics.record({ source: "runtime", type: "interaction_response", phase: "native_resume_boundary", threadId, runId: nativeSuspension.runId, toolCallId, durationMs: performance.now() - resumeStartedAt });
      return { accepted: true };
    } catch (error) {
      const failure: InteractionError = { code: "resume-failed", message: "Mastra could not resume this request. Resubmit the original turn to try again.", retryable: Boolean(interaction.originMessageId) };
      this.markInteractionFailed(threadId, toolCallId, failure);
      this.diagnostics.record({ source: "runtime", type: "interaction_response", phase: "error", threadId, runId: this.ctx.runId, toolCallId, payload: error });
      return this.interactionFailure(failure);
    }
  }

  async dismissInteraction(toolCallId: string): Promise<InteractionResponseResult> {
    await this.ctx.ensureInitialized();
    const threadId = this.ctx.selectedThreadId;
    const interaction = this.ctx.threadState.pendingInteractions?.find((item) => item.toolCallId === toolCallId);
    if (!threadId || !interaction || interaction.status !== "failed") return this.interactionFailure({ code: "stale", message: "That failed interaction is no longer available.", retryable: false });
    const next = this.threads.updateThreadState(threadId, (state) => ({
      ...state,
      pendingInteractions: (state.pendingInteractions ?? []).filter((item) => item.toolCallId !== toolCallId),
      resolvedInteractions: [...(state.resolvedInteractions ?? []), { ...interaction, status: "cancelled" }],
    }));
    await this.threads.persistThreadState(threadId, next);
    if (this.ctx.selectedThreadId === threadId) {
      this.ctx.publish({ interactions: next.pendingInteractions ?? [], workbench: this.threads.workbenchFromState(next, null) });
    }
    return { accepted: true };
  }

  async respondToToolApproval(toolCallId: string, approved: boolean, fingerprint: string): Promise<InteractionResponseResult> {
    await this.ctx.ensureInitialized();
    const pending = this.ctx.threadState.pendingInteractions?.find((item) => item.kind === "tool_approval" && item.toolCallId === toolCallId);
    if (!pending) return this.interactionFailure({ code: "stale", message: "That tool approval is no longer available.", retryable: false });
    if (pending.status !== "pending") return this.interactionFailure({ code: "busy", message: "That tool approval is already being resolved.", retryable: pending.status === "failed" });
    const threadId = this.ctx.selectedThreadId;
    if (!threadId) return this.interactionFailure({ code: "stale", message: "The approval conversation is no longer available.", retryable: false });
    const nativeSuspension = await this.nativeDriver.findSuspension(threadId, toolCallId);
    if (!nativeSuspension || !nativeSuspension.requiresApproval) return this.interactionFailure({ code: "stale", message: "That tool approval has expired.", retryable: false });
    if (pending.runId && pending.runId !== nativeSuspension.runId) return this.interactionFailure({ code: "stale", message: "The approval run changed. Review the current request again.", retryable: false });
    const currentFingerprint = approvalFingerprint(nativeSuspension.toolName ?? pending.toolName ?? "", nativeSuspension.args);
    if (!fingerprint || fingerprint !== pending.fingerprint || fingerprint !== currentFingerprint) return this.interactionFailure({ code: "invalid-response", message: "The tool request changed before approval. Review its current arguments.", retryable: false });
    this.diagnostics.record({ source: "runtime", type: "tool_approval_response", phase: "received", threadId, runId: nativeSuspension.runId, toolCallId, payload: { approved } });
    const resolvingState = this.threads.updateThreadState(threadId, (state) => ({
      ...state,
      pendingInteractions: (state.pendingInteractions ?? []).map((item) => item.toolCallId === toolCallId ? { ...item, status: "resolving" as const } : item),
    }));
    if (this.ctx.selectedThreadId === threadId) this.ctx.publish({ interactions: resolvingState.pendingInteractions ?? [], workbench: this.threads.workbenchFromState(resolvingState, null) });
    try {
      await this.nativeDriver.approve(threadId, nativeSuspension.runId, toolCallId, approved, await this.workspaces.requestContextFor(threadId));
      this.ctx.nativeSuspensions.delete(toolCallId);
      this.projector.recordToolOutcome(toolCallId, approved ? undefined : { content: MASTRA_TOOL_DECLINED_MESSAGE }, false, approved ? "running" : "declined");
      const resolvedState = this.threads.updateThreadState(threadId, (state) => ({
        ...state,
        pendingInteractions: (state.pendingInteractions ?? []).filter((item) => item.toolCallId !== toolCallId),
        resolvedInteractions: [...(state.resolvedInteractions ?? []), { ...pending, status: approved ? "approved" : "rejected" }],
      }));
      if (this.ctx.selectedThreadId === threadId) this.ctx.publish({ interactions: resolvedState.pendingInteractions ?? [], workbench: this.threads.workbenchFromState(resolvedState, null) });
      await this.continuation.beginContinuation(threadId, pending, nativeSuspension.runId, approved ? "approved" : "declined");
      this.diagnostics.record({ source: "runtime", type: "tool_approval_response", phase: "native_resume_boundary", threadId, runId: nativeSuspension.runId, toolCallId, payload: { approved } });
      return { accepted: true };
    } catch (error) {
      const failure: InteractionError = { code: "resume-failed", message: "Mastra could not apply this tool decision. Try again.", retryable: true };
      this.markInteractionFailed(threadId, toolCallId, failure);
      this.diagnostics.record({ source: "runtime", type: "tool_approval_response", phase: "error", threadId, runId: nativeSuspension.runId, toolCallId, payload: normalizeError(error) });
      return this.interactionFailure(failure);
    }
  }
}
