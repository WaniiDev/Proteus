import { randomUUID } from "node:crypto";
import { Memory } from "@mastra/memory";
import type { RuntimeError } from "../../shared/contracts";
import { applyToolOutcomes, upsertChatMessage, upsertPendingInteraction, parseSuspendedInteraction, parseToolApproval } from "../runtime-projection";
import { RuntimeDiagnostics } from "../diagnostics";
import { NativeThreadRepository } from "../native-thread-repository";
import { NativeAgentDriver } from "../native-agent-driver";
import type { NativeAgentChunk, NativeStreamProjection } from "../native-stream-projection";
import { MAX_INPUT_LENGTH, RESOURCE_ID } from "./constants";
import { chatRole, extractText } from "./message-mapping";
import type { MastraMessage, PersistedThreadState } from "./types";
import { makeRuntimeError, normalizeError } from "../runtime-error-mapping";
import type { RuntimeContext } from "./context";
import type { MessageProjector } from "./message-projector";
import type { ThreadService } from "./thread-service";
import type { ContinuationService } from "./continuation-service";
import type { InteractionService } from "./interaction-service";
import type { WorkspaceService } from "./workspace-service";

/** Run lifecycle: native stream projection, send/queue/retry/continue and abort. */
export class RunCoordinator {
  private readonly nativeDriver: NativeAgentDriver;
  private readonly diagnostics: RuntimeDiagnostics;
  private readonly memory: Memory;
  private readonly threadRepo: NativeThreadRepository;
  private readonly threads: ThreadService;
  private readonly workspaces: WorkspaceService;
  private readonly interactions: InteractionService;
  private readonly continuation: ContinuationService;
  private readonly projector: MessageProjector;

  constructor(private readonly ctx: RuntimeContext, deps: { nativeDriver: NativeAgentDriver; diagnostics: RuntimeDiagnostics; memory: Memory; threadRepo: NativeThreadRepository; threads: ThreadService; workspaces: WorkspaceService; interactions: InteractionService; continuation: ContinuationService; projector: MessageProjector }) {
    this.nativeDriver = deps.nativeDriver;
    this.diagnostics = deps.diagnostics;
    this.memory = deps.memory;
    this.threadRepo = deps.threadRepo;
    this.threads = deps.threads;
    this.workspaces = deps.workspaces;
    this.interactions = deps.interactions;
    this.continuation = deps.continuation;
    this.projector = deps.projector;
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

    // The shared activeRun can still name this run after the user switched away; the terminal chunk must end it.
    if (projection.terminal && threadId !== this.ctx.selectedThreadId && this.ctx.snapshot.activeRun?.runId === runId) {
      this.ctx.publish({ status: projection.terminal === "error" ? "error" : this.ctx.idleStatus(), activeRun: null });
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
    } else if (this.ctx.snapshot.activeRun?.threadId === threadId) {
      this.ctx.publish({ status: outcome === "error" ? "error" : this.ctx.idleStatus(), activeRun: null });
    }
  }

  async send(text: string, clientMessageId?: string): Promise<{ runId: string }> {
    return this.ctx.enqueueComposerMutation(async () => {
      const candidate = text.trim();
      if (!candidate) throw new Error("Message cannot be empty");
      if (candidate.length > MAX_INPUT_LENGTH) throw new Error(`Message must be ${MAX_INPUT_LENGTH} characters or fewer`);
      const messageId = clientMessageId?.trim() || randomUUID();
      if (this.ctx.pendingThreadSelectionId !== null) throw makeRuntimeError("busy");
      await this.ctx.ensureInitialized();
      if (this.ctx.snapshot.selectedProviderId === "openrouter" && (!this.ctx.snapshot.credential.configured || !this.ctx.snapshot.credential.verified)) throw makeRuntimeError("invalid-credential");
      if (this.ctx.snapshot.selectedProviderId === "codex" && this.ctx.snapshot.providers.find((provider) => provider.id === "codex")?.availability !== "ready") throw makeRuntimeError("model-unavailable");
      let threadId = this.ctx.selectedThreadId ?? this.ctx.snapshot.activeThreadId;
      if (!threadId) threadId = await this.threads.createThread("New chat");
      return this.queueNativeMessage(threadId, candidate, { clientMessageId: messageId, optimistic: true });
    });
  }

  private async queueNativeMessage(threadId: string, candidate: string, options: { clientMessageId?: string; optimistic?: boolean } = {}): Promise<{ runId: string }> {
    const messageId = options.clientMessageId ?? randomUUID();
    if (options.optimistic !== false) {
      const createdAt = new Date().toISOString();
      this.ctx.optimisticUserMessages.set(messageId, {
        threadId,
        message: { id: messageId, role: "user", text: candidate, turnId: messageId, parts: [{ type: "text", id: `${messageId}:text:0`, text: candidate }], status: "complete", createdAt },
      });
      this.ctx.publish({ messages: this.projector.mergeTransientMessages(threadId, this.ctx.snapshot.messages), error: null, retryMessageId: null });
    }
    let result: { runId: string; queued: boolean };
    try {
      result = await this.nativeDriver.queue(threadId, candidate, { clientMessageId: messageId }, await this.workspaces.requestContextFor(threadId));
    } catch (error) {
      // Roll the optimistic message back so a resend does not show it twice.
      if (options.optimistic !== false && this.ctx.optimisticUserMessages.delete(messageId)) this.ctx.publish({ messages: this.ctx.snapshot.messages.filter((message) => message.id !== messageId) });
      throw error;
    }
    if (!result.queued) {
      this.ctx.runClientMessageId = options.optimistic === false ? null : messageId;
      this.ctx.runId = result.runId;
      this.ctx.runThreadId = threadId;
      this.ctx.publish({ status: "running", activeRun: { runId: result.runId, threadId, status: "running" } });
    } else {
      this.ctx.publish({ workbench: this.threads.workbenchFromState(this.ctx.threadState, null) });
    }
    return { runId: result.runId };
  }

  async retry(messageId: string): Promise<{ runId: string }> {
    if (this.ctx.startingRun || this.ctx.runId || this.ctx.pendingThreadSelectionId !== null) throw makeRuntimeError("busy");
    this.ctx.startingRun = true;
    this.ctx.startingRunAbortRequested = false;
    const reservationThreadId = this.ctx.selectedThreadId ?? this.ctx.snapshot.activeThreadId;
    const reservationId = reservationThreadId ? `starting:retry:${randomUUID()}` : null;
    this.ctx.startingRunId = reservationId;
    if (reservationId && reservationThreadId) {
      this.ctx.publish({
        status: "running",
        activeRun: {
          runId: reservationId,
          threadId: reservationThreadId,
          status: "running",
        },
        error: null,
        retryMessageId: null,
      });
    }
    try {
      return await this.retryReserved(messageId);
    } finally {
      const abortedBeforeStart = this.ctx.startingRunAbortRequested;
      this.ctx.startingRun = false;
      this.ctx.startingRunAbortRequested = false;
      if (this.ctx.startingRunId === reservationId) {
        this.ctx.startingRunId = null;
        if (reservationId && this.ctx.runId === null && this.ctx.snapshot.activeRun?.runId === reservationId) {
          this.ctx.publish({
            status: this.ctx.idleStatus(),
            activeRun: null,
            ...(abortedBeforeStart ? { error: makeRuntimeError("aborted") } : {}),
          });
        }
      }
    }
  }

  private async retryReserved(messageId: string): Promise<{ runId: string }> {
    await this.ctx.ensureInitialized();
    if (this.ctx.runId) throw makeRuntimeError("busy");
    const sourceThreadId = this.ctx.selectedThreadId ?? "";
    const messages = await this.threadRepo.recall(sourceThreadId) as MastraMessage[];
    const index = messages.findIndex((message) => message.id === messageId);
    let sourceIndex = -1;
    if (index >= 0) {
      for (let candidate = index; candidate >= 0; candidate -= 1) {
        if (chatRole(messages[candidate]) === "user") {
          sourceIndex = candidate;
          break;
        }
      }
    }
    const source = sourceIndex >= 0 ? messages[sourceIndex] : undefined;
    const optimistic = !source ? this.ctx.optimisticUserMessages.get(messageId) : undefined;
    const content = source ? extractText(source) : optimistic?.message.text;
    if (!content) throw new Error("The original user message could not be recovered");
    if (this.ctx.startingRunAbortRequested) throw makeRuntimeError("aborted");
    if (!source) {
      this.ctx.retryingText = null;
      this.ctx.hideSingleRetry = false;
      return this.queueNativeMessage(sourceThreadId, content, { optimistic: true, clientMessageId: messageId });
    }
    const originalThread = await this.threadRepo.get(sourceThreadId);
    const sourceState = await this.threads.loadThreadState(sourceThreadId);
    if (this.ctx.startingRunAbortRequested) throw makeRuntimeError("aborted");
    const { thread: retryThread } = await this.memory.cloneThread({
      sourceThreadId,
      title: `${originalThread?.title?.trim() || "Conversation"} · retry`,
      resourceId: RESOURCE_ID,
    });
    try {
      const staleInteractions = sourceState.pendingInteractions ?? [];
      const retryState: PersistedThreadState = {
        ...sourceState,
        pendingInteractions: [],
        resolvedInteractions: [
          ...(sourceState.resolvedInteractions ?? []),
          ...staleInteractions.map((item) => ({
            ...item,
            status: "cancelled" as const,
          })),
        ],
      };
      await this.threads.persistThreadState(retryThread.id, retryState);
      const retryMessages = await this.threadRepo.recall(retryThread.id) as MastraMessage[];
      const sourceUserOrdinal = messages.slice(0, sourceIndex + 1).filter((message) => chatRole(message) === "user" && extractText(message) === content).length - 1;
      let retrySourceIndex = -1;
      let seenMatchingUser = 0;
      for (let candidate = 0; candidate < retryMessages.length; candidate += 1) {
        if (chatRole(retryMessages[candidate]) === "user" && extractText(retryMessages[candidate]) === content) {
          if (seenMatchingUser === sourceUserOrdinal) {
            retrySourceIndex = candidate;
            break;
          }
          seenMatchingUser += 1;
        }
      }
      if (retrySourceIndex < 0) throw new Error("The retry branch could not recover the original turn");
      const removeIds = retryMessages.slice(retrySourceIndex).map((message) => message.id);
      if (removeIds.length > 0) await this.memory.deleteMessages(removeIds);
      if (this.ctx.startingRunAbortRequested) throw makeRuntimeError("aborted");
      await this.threads.syncThreadState({ threadId: retryThread.id });
      if (this.ctx.startingRunAbortRequested) throw makeRuntimeError("aborted");
      this.ctx.retryingText = null;
      this.ctx.hideSingleRetry = false;
      return await this.queueNativeMessage(retryThread.id, content, { optimistic: true });
    } catch (error) {
      // A clone nobody will ever open must not linger as an orphan "· retry" conversation, nor stay selected.
      this.ctx.threadStateCache.delete(retryThread.id);
      await this.threadRepo.delete(retryThread.id).catch(() => undefined);
      if (this.ctx.selectedThreadId === retryThread.id) await this.threads.syncThreadState({ threadId: sourceThreadId }).catch(() => undefined);
      throw error;
    }
  }

  async continueFrom(messageId: string): Promise<{ runId: string }> {
    if (this.ctx.startingRun || this.ctx.runId || this.ctx.pendingThreadSelectionId !== null) throw makeRuntimeError("busy");
    this.ctx.startingRun = true;
    this.ctx.startingRunAbortRequested = false;
    const reservationThreadId = this.ctx.selectedThreadId ?? this.ctx.snapshot.activeThreadId;
    const reservationId = reservationThreadId ? `starting:continue:${randomUUID()}` : null;
    this.ctx.startingRunId = reservationId;
    if (reservationId && reservationThreadId) {
      this.ctx.publish({
        status: "running",
        activeRun: {
          runId: reservationId,
          threadId: reservationThreadId,
          status: "running",
        },
        error: null,
        retryMessageId: null,
      });
    }
    try {
      return await this.continueReserved(messageId);
    } finally {
      const abortedBeforeStart = this.ctx.startingRunAbortRequested;
      this.ctx.startingRun = false;
      this.ctx.startingRunAbortRequested = false;
      if (this.ctx.startingRunId === reservationId) {
        this.ctx.startingRunId = null;
        if (reservationId && this.ctx.runId === null && this.ctx.snapshot.activeRun?.runId === reservationId) {
          this.ctx.publish({
            status: this.ctx.idleStatus(),
            activeRun: null,
            ...(abortedBeforeStart ? { error: makeRuntimeError("aborted") } : {}),
          });
        }
      }
    }
  }

  private async continueReserved(messageId: string): Promise<{ runId: string }> {
    await this.ctx.ensureInitialized();
    if (this.ctx.runId) throw makeRuntimeError("busy");
    if (this.ctx.startingRunAbortRequested) throw makeRuntimeError("aborted");
    const message = this.ctx.snapshot.messages.find((item) => item.id === messageId);
    if (!message) throw new Error("Stopped response not found");
    const continuation = "Continue from the stopped response without repeating what is already visible. Finish the answer naturally.";
    this.ctx.retryingText = continuation;
    this.ctx.hideSingleRetry = true;
    const threadId = this.ctx.selectedThreadId;
    if (!threadId) throw new Error("No active conversation");
    return this.queueNativeMessage(threadId, continuation, { optimistic: false });
  }

  abort(): void {
    if (!this.ctx.runId) {
      if (this.ctx.startingRun && this.ctx.startingRunId && this.ctx.snapshot.activeRun?.runId === this.ctx.startingRunId) {
        this.ctx.startingRunAbortRequested = true;
        this.ctx.publish({
          activeRun: {
            runId: this.ctx.startingRunId,
            threadId: this.ctx.snapshot.activeRun.threadId,
            status: "aborted",
          },
          error: makeRuntimeError("aborted"),
        });
      }
      return;
    }
    const runId = this.ctx.runId;
    const threadId = this.ctx.runThreadId ?? this.ctx.selectedThreadId;
    this.ctx.runOutcome = "interrupted";
    this.ctx.runError = makeRuntimeError("aborted");
    const continuation = threadId ? this.threads.stateFor(threadId).continuation : null;
    if (threadId && continuation) {
      this.continuation.clearContinuationTimers(threadId);
      const next = this.threads.updateThreadState(threadId, (state) => ({ ...state, continuation: null }));
      void this.threads.persistThreadState(threadId, next);
      if (this.ctx.selectedThreadId === threadId) this.ctx.publish({ continuation: null });
      this.diagnostics.record({ source: "runtime", type: "continuation", phase: "aborted", threadId, runId: continuation.runId, toolCallId: continuation.toolCallId });
    }
    const pendingInteractions = threadId ? this.threads.stateFor(threadId).pendingInteractions ?? [] : [];
    if (threadId && pendingInteractions.length > 0) {
      this.ctx.resolvingInteractions.clear();
      const next = this.threads.updateThreadState(threadId, (state) => ({
        ...state,
        pendingInteractions: [],
        resolvedInteractions: [
          ...(state.resolvedInteractions ?? []),
          ...pendingInteractions.map((item) => ({
            ...item,
            status: "cancelled" as const,
          })),
        ],
      }));
      void this.threads.persistThreadState(threadId, next);
      if (this.ctx.selectedThreadId === threadId)
        this.ctx.publish({
          interactions: [],
          workbench: this.threads.workbenchFromState(next, null),
        });
    }
    // Mastra only reports an abort for a run it still has; with none, no terminal chunk will ever arrive.
    if (threadId && this.nativeDriver.abort(threadId)) {
      this.ctx.publish({ activeRun: { runId, threadId, status: "aborted" }, error: this.ctx.runError });
      return;
    }
    this.continuation.clearContinuationTimers(threadId);
    this.ctx.releaseRun(runId);
    if (threadId) this.threads.updateThreadActivity(threadId, "interrupted", 0);
    if (!threadId || this.ctx.selectedThreadId === threadId || this.ctx.snapshot.activeRun?.runId === runId) this.ctx.publish({ status: this.ctx.idleStatus(), activeRun: null, error: this.ctx.runError });
  }
}
