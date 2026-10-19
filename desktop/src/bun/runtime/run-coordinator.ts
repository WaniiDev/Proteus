import type { RuntimeError } from "../../shared/contracts";
import { applyToolOutcomes, upsertChatMessage, upsertPendingInteraction, parseSuspendedInteraction, parseToolApproval } from "../runtime-projection";
import { RuntimeDiagnostics } from "../diagnostics";
import type { NativeAgentChunk, NativeStreamProjection } from "../native-stream-projection";
import { makeRuntimeError, normalizeError } from "../runtime-error-mapping";
import type { RuntimeContext } from "./context";
import type { ThreadService } from "./thread-service";
import type { ContinuationService } from "./continuation-service";
import type { InteractionService } from "./interaction-service";

/** Run lifecycle: native stream projection, send/queue/retry/continue and abort. */
export class RunCoordinator {
  private readonly diagnostics: RuntimeDiagnostics;
  private readonly threads: ThreadService;
  private readonly interactions: InteractionService;
  private readonly continuation: ContinuationService;

  constructor(private readonly ctx: RuntimeContext, deps: { diagnostics: RuntimeDiagnostics; threads: ThreadService; interactions: InteractionService; continuation: ContinuationService }) {
    this.diagnostics = deps.diagnostics;
    this.threads = deps.threads;
    this.interactions = deps.interactions;
    this.continuation = deps.continuation;
  }

  handleNativeProjection(projection: NativeStreamProjection, chunk: NativeAgentChunk): void {
    const { threadId, runId } = projection;
    const payload = chunk.payload ?? {};
    const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : undefined;
    this.diagnostics.record({ source: "mastra", type: chunk.type, threadId, runId, toolCallId, payload: chunk });
    this.continuation.markContinuationProgress(chunk, threadId, runId);

    if (chunk.type === "start") {
      if (this.threads.stateFor(threadId).continuation?.runId !== runId) this.ctx.runToolOutcomes.clear();
      this.ctx.runId = runId;
      this.ctx.runThreadId = threadId;
      this.ctx.runOutcome = "streaming";
      this.ctx.runError = null;
      this.threads.updateThreadActivity(threadId, "running", 0);
    }

    if (chunk.type === "tool-call-suspended" && toolCallId && typeof payload.toolName === "string") {
      this.ctx.nativeSuspensions.set(toolCallId, { runId, threadId });
      const interaction = parseSuspendedInteraction(
        { toolCallId, toolName: payload.toolName, suspendPayload: payload.suspendPayload },
        this.threads.nextPlanVersion(threadId),
        this.ctx.runClientMessageId ?? undefined,
      );
      if (interaction) {
        const boundInteraction = { ...interaction, threadId, runId, toolName: payload.toolName };
        const next = this.threads.updateThreadState(threadId, (state) => ({ ...state, pendingInteractions: upsertPendingInteraction(state.pendingInteractions ?? [], boundInteraction) }));
        if (threadId === this.ctx.selectedThreadId) this.ctx.publish({ interactions: next.pendingInteractions ?? [], workbench: this.threads.workbenchFromState(next, null) });
      }
      if (payload.toolName === "submit_plan") {
        const suspendPayload = payload.suspendPayload && typeof payload.suspendPayload === "object" ? payload.suspendPayload as { path?: unknown } : {};
        void this.interactions.hydratePlanSuspension(threadId, toolCallId, suspendPayload.path, this.ctx.runClientMessageId ?? undefined);
      }
      this.threads.updateThreadActivity(threadId, "waiting", 1);
    }

    if (chunk.type === "tool-call-approval" && toolCallId && typeof payload.toolName === "string") {
      this.ctx.nativeSuspensions.set(toolCallId, { runId, threadId });
      const interaction = parseToolApproval({ threadId, runId, toolCallId, toolName: payload.toolName, args: payload.args });
      const next = this.threads.updateThreadState(threadId, (state) => ({ ...state, pendingInteractions: upsertPendingInteraction(state.pendingInteractions ?? [], interaction) }));
      if (threadId === this.ctx.selectedThreadId) this.ctx.publish({ interactions: next.pendingInteractions ?? [], workbench: this.threads.workbenchFromState(next, null) });
      this.threads.updateThreadActivity(threadId, "waiting", 1);
    }

    if ((chunk.type === "tool-result" || chunk.type === "tool-error") && toolCallId && this.ctx.runToolOutcomes.get(toolCallId)?.status === "running") this.ctx.runToolOutcomes.delete(toolCallId);
    if (chunk.type === "tool-result") void this.threads.refreshNativeTasks(threadId);

    const renderedMessage = applyToolOutcomes([projection.message], this.ctx.runToolOutcomes)[0];

    const terminalError = projection.terminal === "error"
      ? normalizeError(projection.terminalError)
      : projection.terminal === "interrupted"
        ? makeRuntimeError("aborted")
        : null;

    if (threadId === this.ctx.selectedThreadId && (renderedMessage.parts.length > 0 || projection.terminal === "error")) {
      this.ctx.lastAssistantId = renderedMessage.id;
      const projectedMessage = terminalError
        ? { ...renderedMessage, retryable: terminalError.retryable }
        : renderedMessage;
      this.ctx.publish({
        status: projection.terminal === "error" ? "error" : projection.terminal ? this.ctx.idleStatus() : "running",
        activeRun: projection.terminal ? null : { runId, threadId, status: "running" },
        messages: upsertChatMessage(this.ctx.snapshot.messages, projectedMessage),
        ...(projection.terminal === "complete" ? { error: null } : terminalError ? { error: terminalError } : {}),
        ...(projection.usage ? { workbench: { ...this.threads.workbenchFromState(this.threads.stateFor(threadId), null), tokenUsage: projection.usage } } : {}),
      });
    }

    if (projection.terminal) {
      this.continuation.finishContinuation(threadId, runId, projection.terminal);
      this.ctx.releaseRun(runId);
      this.ctx.runOutcome = projection.terminal === "complete" ? "complete" : projection.terminal === "interrupted" ? "interrupted" : "error";
      this.ctx.runError = terminalError;
      this.threads.updateThreadActivity(threadId, projection.terminal === "complete" ? "complete" : projection.terminal === "interrupted" ? "interrupted" : "error", 0);
      void this.settleNativeRun(threadId, projection.terminal, terminalError);
    }
  }

  handleNativeDriverError(error: unknown, threadId: string): void {
    const normalized = normalizeError(error);
    this.diagnostics.record({ source: "mastra", type: "stream_consume_error", threadId, runId: this.ctx.runId, payload: error });
    const continuation = this.threads.stateFor(threadId).continuation;
    if (continuation) {
      void this.continuation.reconcileContinuation("stream-error", continuation);
      return;
    }
    // An error from another thread must not end the run that owns the shared marker.
    if (this.ctx.runThreadId === threadId || !this.ctx.runId) {
      this.ctx.runOutcome = "error";
      this.ctx.runError = normalized;
      this.ctx.runId = null;
      this.ctx.runThreadId = null;
    }
    this.threads.updateThreadActivity(threadId, "error", 0);
    if (threadId === this.ctx.selectedThreadId) this.ctx.publish({ status: "error", activeRun: null, error: normalized });
    void this.settleNativeRun(threadId, "error", normalized);
  }

  handleNativeDriverClose(threadId: string, activeRunId: string | null): void {
    this.diagnostics.record({ source: "mastra", type: "stream_closed", threadId, runId: activeRunId ?? this.ctx.runId ?? undefined });
    const continuation = this.threads.stateFor(threadId).continuation;
    if (continuation) {
      void this.continuation.reconcileContinuation("stream-close", continuation);
      return;
    }
    const runId = activeRunId ?? (this.ctx.runId && this.ctx.runThreadId === threadId ? this.ctx.runId : null);
    if (!runId) return;
    const error: RuntimeError = { code: "unknown", message: "The response stream closed before Proteus reported a final result.", retryable: true };
    this.ctx.releaseRun(runId);
    this.ctx.runOutcome = "error";
    this.ctx.runError = error;
    this.threads.updateThreadActivity(threadId, "error", 0);
    if (threadId === this.ctx.selectedThreadId) this.ctx.publish({ status: "error", activeRun: null, error });
    void this.settleNativeRun(threadId, "error", error);
  }

  private async settleNativeRun(threadId: string, outcome: NativeStreamProjection["terminal"], error: RuntimeError | null): Promise<void> {
    await this.threads.refreshNativeTasks(threadId);
    await this.threads.syncMessagesSafely(threadId);
    await this.threads.refreshThreadSummaries();
    if (threadId === this.ctx.selectedThreadId) {
      this.ctx.publish({
        status: outcome === "error" ? "error" : this.ctx.idleStatus(),
        activeRun: null,
        ...(outcome === "complete" ? { error: null } : error ? { error } : {}),
        workbench: this.threads.workbenchFromState(this.ctx.threadState, null),
      });
    }
  }
}
