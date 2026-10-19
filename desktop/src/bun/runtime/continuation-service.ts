import type { ChatMessage, ContinuationState, InteractionError, PendingInteraction, RuntimeError } from "../../shared/contracts";
import { RuntimeDiagnostics } from "../core/diagnostics";
import { NativeAgentDriver } from "../native/native-agent-driver";
import type { NativeAgentChunk, NativeStreamProjection } from "../native/native-stream-projection";
import { CONTINUATION_PROGRESS_PERSIST_MS, CONTINUATION_RECOVERY_MS, CONTINUATION_SLOW_MS } from "./constants";
import type { RuntimeContext } from "./context";
import type { ThreadService } from "./thread-service";

/** Tracks a resumed run after a decision: progress, slow and recovery timers, and reconciliation. */
export class ContinuationService {
  /** Timers and progress bookkeeping are per thread: several threads can have a resumed run at once. */
  private readonly tracks = new Map<string, { warning: ReturnType<typeof setTimeout> | null; recovery: ReturnType<typeof setTimeout> | null; hadText: boolean; lastPersistedAt: number }>();
  private readonly nativeDriver: NativeAgentDriver;
  private readonly diagnostics: RuntimeDiagnostics;
  private readonly threads: ThreadService;

  constructor(private readonly ctx: RuntimeContext, deps: { nativeDriver: NativeAgentDriver; diagnostics: RuntimeDiagnostics; threads: ThreadService }) {
    this.nativeDriver = deps.nativeDriver;
    this.diagnostics = deps.diagnostics;
    this.threads = deps.threads;
  }

  private track(threadId: string) {
    let track = this.tracks.get(threadId);
    if (!track) this.tracks.set(threadId, track = { warning: null, recovery: null, hadText: false, lastPersistedAt: 0 });
    return track;
  }

  /** Clear one thread's slow/recovery timers, or every thread's when none is given. */
  clearContinuationTimers(threadId?: string | null): void {
    for (const id of threadId ? [threadId] : [...this.tracks.keys()]) {
      const track = this.tracks.get(id);
      if (!track) continue;
      if (track.warning) clearTimeout(track.warning);
      if (track.recovery) clearTimeout(track.recovery);
      track.warning = null;
      track.recovery = null;
    }
  }

  /** Stop and drop a deleted thread's timers and bookkeeping. */
  forgetThread(threadId: string): void {
    this.clearContinuationTimers(threadId);
    this.tracks.delete(threadId);
  }

  armContinuationTimers(continuation: ContinuationState | null | undefined = this.ctx.threadState.continuation): void {
    this.clearContinuationTimers(continuation?.threadId ?? this.ctx.selectedThreadId);
    if (!continuation) return;
    const { threadId } = continuation;
    const track = this.track(threadId);
    const elapsed = Math.max(0, Date.now() - Date.parse(continuation.lastProgressAt));
    track.warning = setTimeout(() => {
      const current = this.threads.stateFor(threadId).continuation;
      if (!current || current.toolCallId !== continuation.toolCallId) return;
      const slow = { ...current, phase: "slow" as const };
      const next = this.threads.updateThreadState(threadId, (state) => ({ ...state, continuation: slow }));
      if (this.ctx.selectedThreadId === threadId) this.ctx.publish({ continuation: slow });
      this.diagnostics.record({ source: "runtime", type: "continuation", phase: "slow", threadId, runId: slow.runId, toolCallId: slow.toolCallId, durationMs: Date.now() - Date.parse(slow.startedAt) });
      void this.threads.persistThreadState(threadId, next);
    }, Math.max(0, CONTINUATION_SLOW_MS - elapsed));
    track.recovery = setTimeout(() => {
      const current = this.threads.stateFor(threadId).continuation;
      if (!current || current.toolCallId !== continuation.toolCallId) return;
      const recovery = { ...current, phase: "recovery" as const };
      const next = this.threads.updateThreadState(threadId, (state) => ({ ...state, continuation: recovery }));
      if (this.ctx.selectedThreadId === threadId) this.ctx.publish({ continuation: recovery });
      this.diagnostics.record({ source: "runtime", type: "continuation", phase: "recovery", threadId, runId: recovery.runId, toolCallId: recovery.toolCallId, durationMs: Date.now() - Date.parse(recovery.startedAt) });
      void this.threads.persistThreadState(threadId, next);
      void this.reconcileContinuation("timeout", recovery);
    }, Math.max(0, CONTINUATION_RECOVERY_MS - elapsed));
  }

  async beginContinuation(
    threadId: string,
    interaction: PendingInteraction,
    runId: string,
    decision: ContinuationState["decision"],
  ): Promise<void> {
    const now = new Date().toISOString();
    const continuation: ContinuationState = {
      interactionId: interaction.id,
      toolCallId: interaction.toolCallId,
      threadId,
      runId,
      kind: interaction.kind,
      decision,
      phase: "resuming",
      startedAt: now,
      lastProgressAt: now,
    };
    let events = this.threads.stateFor(threadId).events ?? [];
    if (decision === "declined") {
      const id = `continuation:${interaction.toolCallId}:declined`;
      if (!events.some((event) => event.id === id)) events = [...events, { id, type: "system", text: "Tool declined. Proteus is continuing without it.", createdAt: now }];
    }
    const next = this.threads.updateThreadState(threadId, (state) => ({ ...state, continuation, events }));
    this.ctx.runId = runId;
    this.ctx.runThreadId = threadId;
    this.ctx.runOutcome = "streaming";
    this.ctx.runError = null;
    this.track(threadId).hadText = false;
    this.track(threadId).lastPersistedAt = Date.now();
    this.threads.updateThreadActivity(threadId, "running", 0);
    if (this.ctx.selectedThreadId === threadId) {
      this.ctx.publish({
        status: "running",
        activeRun: { runId, threadId, status: "running" },
        continuation,
        events,
        error: null,
        workbench: this.threads.workbenchFromState(next, null, { runId, threadId, status: "running" }),
      });
    }
    this.armContinuationTimers(continuation);
    this.diagnostics.record({ source: "runtime", type: "continuation", phase: "acknowledged", threadId, runId, toolCallId: interaction.toolCallId });
    // A failed save is surfaced by persistThreadState; the continuation keeps running.
    await this.threads.persistThreadState(threadId, next);
  }

  markContinuationProgress(chunk: NativeAgentChunk, threadId: string, runId: string): void {
    const continuation = this.threads.stateFor(threadId).continuation;
    if (!continuation || continuation.threadId !== threadId || continuation.runId !== runId) return;
    const meaningful = new Set(["step-start", "text-delta", "tool-result", "tool-error", "tool-call-approval", "tool-call-suspended", "error", "abort", "finish"]);
    if (!meaningful.has(chunk.type)) return;
    if (chunk.type === "text-delta" && typeof chunk.payload?.text === "string" && chunk.payload.text.length > 0) this.track(threadId).hadText = true;
    const progressed = { ...continuation, phase: "resuming" as const, lastProgressAt: new Date().toISOString() };
    const next = this.threads.updateThreadState(threadId, (state) => ({ ...state, continuation: progressed }));
    if (this.ctx.selectedThreadId === threadId) this.ctx.publish({ continuation: progressed });
    this.diagnostics.record({ source: "runtime", type: "continuation", phase: "progress", threadId, runId, toolCallId: continuation.toolCallId, payload: { chunkType: chunk.type } });
    const track = this.track(threadId);
    if (Date.now() - track.lastPersistedAt >= CONTINUATION_PROGRESS_PERSIST_MS) {
      track.lastPersistedAt = Date.now();
      void this.threads.persistThreadState(threadId, next);
    }
    if (chunk.type !== "finish" && chunk.type !== "abort" && chunk.type !== "error") this.armContinuationTimers(progressed);
  }

  finishContinuation(threadId: string, runId: string, outcome: NonNullable<NativeStreamProjection["terminal"]>): void {
    const continuation = this.threads.stateFor(threadId).continuation;
    if (!continuation || continuation.threadId !== threadId || continuation.runId !== runId) return;
    this.clearContinuationTimers(threadId);
    let events = this.threads.stateFor(threadId).events ?? [];
    if (outcome === "complete" && !this.track(threadId).hadText) {
      const id = `continuation:${continuation.toolCallId}:complete`;
      if (!events.some((event) => event.id === id)) events = [...events, { id, type: "system", text: "Proteus continued after your decision and finished without another message.", createdAt: new Date().toISOString() }];
    }
    const next = this.threads.updateThreadState(threadId, (state) => ({ ...state, continuation: null, events }));
    this.track(threadId).hadText = false;
    if (this.ctx.selectedThreadId === threadId) this.ctx.publish({ continuation: null, events });
    this.diagnostics.record({ source: "runtime", type: "continuation", phase: outcome, threadId, runId, toolCallId: continuation.toolCallId, durationMs: Date.now() - Date.parse(continuation.startedAt) });
    void this.threads.persistThreadState(threadId, next);
  }

  /** The run is settled, so a snapshot still showing it as active (e.g. after switching away) must not keep claiming it. */
  private clearStaleActiveRun(continuation: ContinuationState): void {
    if (this.ctx.selectedThreadId !== continuation.threadId && this.ctx.snapshot.activeRun?.runId === continuation.runId) this.ctx.publish({ status: this.ctx.idleStatus(), activeRun: null });
  }

  private continuationHasCompletedHistory(continuation: ContinuationState, messages: ChatMessage[]): boolean {
    const startedAt = Date.parse(continuation.startedAt);
    return messages.some((message) => message.role === "assistant" && message.status === "complete" && Date.parse(message.createdAt) >= startedAt && (message.text.trim().length > 0 || message.parts.some((part) => part.type === "tool" && part.toolCallId === continuation.toolCallId && ["completed", "declined", "cancelled", "error"].includes(part.status))));
  }

  async reconcileContinuation(reason: "startup" | "timeout" | "stream-close" | "stream-error", continuation: ContinuationState | null | undefined = this.ctx.threadState.continuation): Promise<void> {
    if (!continuation) return;
    const { threadId } = continuation;
    this.diagnostics.record({ source: "runtime", type: "continuation_reconcile", phase: "start", threadId, runId: continuation.runId, toolCallId: continuation.toolCallId, payload: { reason } });
    await this.threads.syncMessagesSafely(threadId);
    const suspensions = await this.nativeDriver.listSuspensions(threadId).catch(() => []);
    const exact = suspensions.find((item) => item.runId === continuation.runId && item.toolCallId === continuation.toolCallId);
    if (exact) {
      const reconciled = await this.threads.reconcileNativeSuspensions(threadId, this.threads.stateFor(threadId));
      const retryable: InteractionError = { code: "resume-failed", message: "The previous response did not settle. Review and submit your decision again.", retryable: true };
      const next = this.threads.updateThreadState(threadId, () => ({
        ...reconciled,
        continuation: null,
        pendingInteractions: (reconciled.pendingInteractions ?? []).map((item) => item.toolCallId === continuation.toolCallId ? { ...item, status: "pending" as const, error: retryable } : item),
        resolvedInteractions: (reconciled.resolvedInteractions ?? []).filter((item) => item.toolCallId !== continuation.toolCallId),
      }));
      this.clearContinuationTimers(threadId);
      this.ctx.releaseRun(continuation.runId);
      this.clearStaleActiveRun(continuation);
      if (this.ctx.selectedThreadId === threadId) this.ctx.publish({ status: this.ctx.idleStatus(), activeRun: null, continuation: null, interactions: next.pendingInteractions ?? [], workbench: this.threads.workbenchFromState(next, null, null) });
      await this.threads.persistThreadState(threadId, next);
      this.diagnostics.record({ source: "runtime", type: "continuation_reconcile", phase: "suspended", threadId, runId: continuation.runId, toolCallId: continuation.toolCallId });
      return;
    }
    if (this.continuationHasCompletedHistory(continuation, await this.threads.messagesFor(threadId).catch(() => []))) {
      this.finishContinuation(threadId, continuation.runId, "complete");
      this.ctx.releaseRun(continuation.runId);
      this.clearStaleActiveRun(continuation);
      if (this.ctx.selectedThreadId === threadId) this.ctx.publish({ status: this.ctx.idleStatus(), activeRun: null, error: null });
      return;
    }
    if (this.nativeDriver.activeRunId(threadId) === continuation.runId) {
      const active = { ...continuation, phase: "slow" as const, lastProgressAt: new Date().toISOString() };
      this.threads.updateThreadState(threadId, (state) => ({ ...state, continuation: active }));
      if (this.ctx.selectedThreadId === threadId) this.ctx.publish({ status: "running", activeRun: { runId: continuation.runId, threadId, status: "running" }, continuation: active });
      this.armContinuationTimers(active);
      return;
    }
    this.clearContinuationTimers(threadId);
    const next = this.threads.updateThreadState(threadId, (state) => ({ ...state, continuation: null }));
    this.ctx.releaseRun(continuation.runId);
    this.clearStaleActiveRun(continuation);
    const error: RuntimeError = { code: "unknown", message: "Proteus could not confirm that the response continued. Retry or continue the original turn.", retryable: true };
    if (this.ctx.selectedThreadId === threadId) this.ctx.publish({ status: "error", activeRun: null, continuation: null, error });
    await this.threads.persistThreadState(threadId, next);
    this.diagnostics.record({ source: "runtime", type: "continuation_reconcile", phase: "missing", threadId, runId: continuation.runId, toolCallId: continuation.toolCallId, payload: { reason } });
  }
}
