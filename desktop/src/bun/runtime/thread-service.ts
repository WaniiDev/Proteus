import type { MastraCompositeStore } from "@mastra/core/storage";
import { TASK_STATE_TYPE, type TaskItemSnapshot } from "@mastra/core/tools";
import { LocalFilesystem } from "@mastra/core/workspace";
import type { ChatMessage, RuntimeSnapshot, ThreadSummary, WorkbenchState, WorkbenchTask, WorkspaceBinding } from "../../shared/contracts";
import { upsertPendingInteraction, parseSuspendedInteraction, parseToolApproval } from "../core/runtime-projection";
import { TaskToolPolicy } from "../tools/task-tool-policy";
import { migrateCodexSelection } from "../providers/codex-models";
import { RuntimeDiagnostics } from "../core/diagnostics";
import { parseAppModelSelection, resolveRememberedModelSelection, type AppModelSelection } from "../providers/model-preferences";
import { NativeThreadRepository } from "../native/native-thread-repository";
import { NativeAgentDriver } from "../native/native-agent-driver";
import type { ProjectRegistryStorage } from "../workspace/project-registry";
import { DEFAULT_MODEL_SELECTION, LEGACY_THREAD_METADATA_KEY, RESOURCE_ID, THREAD_METADATA_KEY } from "./constants";
import { compareThreads, emptyTokenUsage, mapThread } from "./message-mapping";
import type { MastraMessage, PersistedThreadState } from "./types";
import { makeRuntimeError } from "../core/runtime-error-mapping";
import type { RuntimeContext } from "./context";
import type { MessageProjector } from "./message-projector";
import { projectSummaries as loadProjectSummaries, scopeFor } from "./workspace-service";

export function uiStateOf(state: PersistedThreadState): PersistedThreadState {
  const { tasks: _legacyTasks, toolOutcomes: _legacyToolOutcomes, ...uiState } = state;
  return structuredClone(uiState);
}

const THREAD_LOAD_FAILED = "This conversation could not be loaded. Select it again to retry.";

/** Thread CRUD, selection and switching, persisted per-thread state and message sync. */
export class ThreadService {
  /** Last state the store accepted per thread; the target a failed save rolls the cache back to. */
  private readonly savedState = new Map<string, PersistedThreadState>();
  /** States derived from a default guess for a thread that was never loaded; they are never saved. */
  private readonly unverified = new WeakSet<object>();
  readonly threadWriteQueues = new Map<string, Promise<void>>();
  threadSwitchQueue: Promise<void> = Promise.resolve();
  private readonly projector: MessageProjector;
  private readonly storage: MastraCompositeStore;
  private readonly nativeDriver: NativeAgentDriver;
  private readonly threadRepo: NativeThreadRepository;
  private readonly diagnostics: RuntimeDiagnostics;
  private readonly projects: ProjectRegistryStorage;
  private readonly planFilesystem: LocalFilesystem;
  private readonly taskToolPolicy: TaskToolPolicy;
  private readonly armTimers: () => void;

  constructor(private readonly ctx: RuntimeContext, deps: { projector: MessageProjector; storage: MastraCompositeStore; nativeDriver: NativeAgentDriver; threadRepo: NativeThreadRepository; diagnostics: RuntimeDiagnostics; projects: ProjectRegistryStorage; planFilesystem: LocalFilesystem; taskToolPolicy: TaskToolPolicy; armTimers: () => void }) {
    this.projector = deps.projector;
    this.storage = deps.storage;
    this.nativeDriver = deps.nativeDriver;
    this.threadRepo = deps.threadRepo;
    this.diagnostics = deps.diagnostics;
    this.projects = deps.projects;
    this.planFilesystem = deps.planFilesystem;
    this.taskToolPolicy = deps.taskToolPolicy;
    this.armTimers = deps.armTimers;
  }

  async loadThreadState(threadId: string): Promise<PersistedThreadState> {
    const cached = this.ctx.threadStateCache.get(threadId);
    if (cached) return this.settleLoadedState(threadId, cached, await this.reconcileNativeThreadState(threadId, structuredClone(cached)));
    // A read error must propagate: defaulting here would cache an app binding that a later save writes over a real project binding.
    const memoryStore = await this.storage.getStore("memory");
    const thread = await memoryStore?.getThreadById({
      threadId,
      resourceId: RESOURCE_ID,
    });
    const value = thread?.metadata?.[THREAD_METADATA_KEY] ?? thread?.metadata?.[LEGACY_THREAD_METADATA_KEY];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const state = structuredClone(value as PersistedThreadState);
      state.workspaceBinding ??= { kind: "app" };
      return this.settleLoadedState(threadId, undefined, await this.reconcileNativeThreadState(threadId, state));
    }
    // No metadata yet is a valid first-run state.
    const empty: PersistedThreadState = { workspaceBinding: { kind: "app" } };
    this.ctx.threadStateCache.set(threadId, empty);
    return structuredClone(empty);
  }

  /** Cache a freshly reconciled state, unless a background update landed meanwhile: that one is newer. */
  private settleLoadedState(threadId: string, startedWith: PersistedThreadState | undefined, reconciled: PersistedThreadState): PersistedThreadState {
    const current = this.ctx.threadStateCache.get(threadId);
    // A cached entry deleted mid-load stays deleted: return this load's result without re-caching a gone thread (an uncached thread's delete is not tracked).
    if (current !== startedWith) return structuredClone(current ?? reconciled);
    this.ctx.threadStateCache.set(threadId, uiStateOf(reconciled));
    if (!startedWith) this.savedState.set(threadId, uiStateOf(reconciled));
    return structuredClone(reconciled);
  }

  private async loadNativeTasks(threadId: string): Promise<WorkbenchTask[]> {
    const store = await this.storage.getStore("threadState");
    const state = await store?.getState<TaskItemSnapshot[]>({ threadId, type: TASK_STATE_TYPE });
    return (state ?? []).map((task) => ({ id: task.id, content: task.content, activeForm: task.activeForm, status: task.status }));
  }

  private async reconcileNativeThreadState(threadId: string, state: PersistedThreadState): Promise<PersistedThreadState> {
    const [tasks, suspensionState] = await Promise.all([
      this.loadNativeTasks(threadId).catch(() => state.tasks ?? []),
      this.reconcileNativeSuspensions(threadId, state),
    ]);
    return { ...suspensionState, tasks };
  }

  async reconcileNativeSuspensions(threadId: string, state: PersistedThreadState): Promise<PersistedThreadState> {
    const suspensions = await this.nativeDriver.listSuspensions(threadId).catch(() => null);
    if (!suspensions) return state;
    const liveIds = new Set(suspensions.flatMap((item) => item.toolCallId ? [item.toolCallId] : []));
    for (const item of suspensions) if (item.toolCallId) this.ctx.nativeSuspensions.set(item.toolCallId, { runId: item.runId, threadId });
    const pending = state.pendingInteractions ?? [];
    const stale = pending.filter((item) => !liveIds.has(item.toolCallId));
    let nextPending = pending.filter((item) => liveIds.has(item.toolCallId));
    let nextVersion = Math.max(0, ...[...(state.pendingInteractions ?? []), ...(state.resolvedInteractions ?? [])].map((item) => item.plan?.version ?? 0));
    for (const item of suspensions) {
      if (!item.toolCallId || !item.toolName) continue;
      if (item.requiresApproval) {
        nextPending = upsertPendingInteraction(nextPending, parseToolApproval({
          threadId,
          runId: item.runId,
          toolCallId: item.toolCallId,
          toolName: item.toolName,
          args: item.args,
        }));
        continue;
      }
      if (nextPending.some((interaction) => interaction.toolCallId === item.toolCallId)) continue;
      let suspendPayload = item.suspendPayload;
      if (item.toolName === "submit_plan" && suspendPayload && typeof suspendPayload === "object" && typeof (suspendPayload as { path?: unknown }).path === "string") {
        const path = (suspendPayload as { path: string }).path;
        try {
          const content = await this.planFilesystem.readFile(path);
          suspendPayload = { ...(suspendPayload as Record<string, unknown>), plan: typeof content === "string" ? content : content.toString("utf8") };
        } catch {
          // Keep the durable suspension visible even when its optional draft cannot be read.
        }
      }
      const parsed = parseSuspendedInteraction({ toolCallId: item.toolCallId, toolName: item.toolName, suspendPayload }, ++nextVersion);
      if (parsed) nextPending = upsertPendingInteraction(nextPending, { ...parsed, threadId, runId: item.runId, toolName: item.toolName });
    }
    const next = stale.length > 0 || nextPending.length !== pending.length
      ? {
          ...state,
          pendingInteractions: nextPending,
          resolvedInteractions: [...(state.resolvedInteractions ?? []), ...stale.map((item) => ({ ...item, status: "cancelled" as const }))],
        }
      : state;
    return structuredClone(next);
  }

  /** State of one thread: the live selected state, or its cached copy when the user has switched away. */
  stateFor(threadId: string): PersistedThreadState {
    if (threadId === this.ctx.selectedThreadId) return this.ctx.threadState;
    const cached = this.ctx.threadStateCache.get(threadId);
    if (cached) return cached;
    // Never loaded: this default is a guess, so it must not be cached or saved over the real state.
    const guess: PersistedThreadState = { workspaceBinding: { kind: "app" } };
    this.unverified.add(guess);
    return guess;
  }

  /** Apply a change to one thread's state by id, never to whichever thread is selected now. */
  updateThreadState(threadId: string, change: (state: PersistedThreadState) => PersistedThreadState): PersistedThreadState {
    const base = this.stateFor(threadId);
    const next = change(base);
    if (threadId === this.ctx.selectedThreadId) this.ctx.threadState = next;
    else if (this.unverified.has(base)) this.unverified.add(next);
    else this.ctx.threadStateCache.set(threadId, uiStateOf(next));
    return next;
  }

  async persistThreadState(threadId: string, state = this.stateFor(threadId), failOnError = false): Promise<void> {
    if (!threadId) return;
    if (this.unverified.has(state)) {
      this.diagnostics.record({ source: "storage", type: "thread_state_write", phase: "skipped", threadId, payload: "state was never loaded" });
      return;
    }
    const next = uiStateOf(state);
    const previousCached = this.ctx.threadStateCache.get(threadId);
    this.ctx.threadStateCache.set(threadId, next);
    const queuedAt = performance.now();
    const previous = this.threadWriteQueues.get(threadId) ?? Promise.resolve();
    const write = previous
      .catch(() => undefined)
      .then(async () => {
        const startedAt = performance.now();
        this.diagnostics.record({ source: "storage", type: "thread_state_write", phase: "start", threadId, durationMs: startedAt - queuedAt });
        try {
          // LibSQL reads, merges and writes without a lock, so this write joins the repository's per-thread queue with pin and rename.
          await this.threadRepo.exclusive(threadId, async () => {
            const memoryStore = await this.storage.getStore("memory");
            const thread = await memoryStore?.getThreadById({
              threadId,
              resourceId: RESOURCE_ID,
            });
            if (failOnError && (!thread || !memoryStore)) throw new Error("Conversation metadata storage is unavailable");
            if (thread && memoryStore) {
              // Write only the key this path owns: the store merges metadata shallowly, so a concurrent pin is never overwritten.
              // The legacy key can only be cleared by an explicit null; mapThread and loadThreadState treat null as absent.
              await memoryStore.updateThread({
                id: threadId,
                metadata: {
                  [THREAD_METADATA_KEY]: next,
                  ...(thread.metadata && LEGACY_THREAD_METADATA_KEY in thread.metadata ? { [LEGACY_THREAD_METADATA_KEY]: null } : {}),
                },
              });
            }
            if (thread && memoryStore) this.savedState.set(threadId, next);
          });
          this.diagnostics.record({ source: "storage", type: "thread_state_write", phase: "end", threadId, durationMs: performance.now() - startedAt });
        } catch (error) {
          this.diagnostics.record({ source: "storage", type: "thread_state_write", phase: "error", threadId, durationMs: performance.now() - startedAt, payload: error });
          // The cache must not claim state the store never accepted.
          if (this.ctx.threadStateCache.get(threadId) === next) {
            const restore = this.savedState.get(threadId) ?? previousCached;
            if (restore) this.ctx.threadStateCache.set(threadId, restore);
            else this.ctx.threadStateCache.delete(threadId);
          }
          if (failOnError) throw error;
          // Workbench metadata must never make text chat fail; surface it without changing run status.
          if (!this.ctx.snapshot.error) this.ctx.publish({ error: { code: "unknown", message: "Some conversation details could not be saved.", retryable: false } });
        }
      });
    let tracked!: Promise<void>;
    tracked = write.finally(() => {
      if (this.threadWriteQueues.get(threadId) === tracked) this.threadWriteQueues.delete(threadId);
    });
    this.threadWriteQueues.set(threadId, tracked);
    await tracked;
  }

  workbenchFromState(state: PersistedThreadState, _displayState: null = null, runStatus: RuntimeSnapshot["activeRun"] = this.ctx.snapshot.activeRun): WorkbenchState {
    const tasks = state.tasks ?? [];
    const pendingInteractions = state.pendingInteractions ?? [];
    const pending = pendingInteractions.some((item) => item.status === "pending" || item.status === "resolving");
    const status: WorkbenchState["status"] = pending ? "waiting" : runStatus?.threadId === this.ctx.selectedThreadId && runStatus.status === "running" ? "active" : runStatus?.threadId === this.ctx.selectedThreadId && runStatus.status === "aborted" ? "interrupted" : this.ctx.snapshot.error && runStatus?.threadId === this.ctx.selectedThreadId ? "error" : tasks.some((task) => task.status !== "completed") ? "active" : tasks.length > 0 ? "complete" : "idle";
    const usage = state.tokenUsage ?? emptyTokenUsage();
    return {
      status,
      goal: state.goal,
      tasks,
      pendingInteractions,
      queuedFollowUpCount: this.ctx.selectedThreadId ? this.nativeDriver.queuedCount(this.ctx.selectedThreadId) : 0,
      tokenUsage: {
        promptTokens: usage.promptTokens ?? 0,
        completionTokens: usage.completionTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
        ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
      },
    };
  }

  updateThreadActivity(threadId: string, activity: ThreadSummary["activity"], attention?: number): void {
    const current = this.ctx.threadActivity.get(threadId);
    this.ctx.threadActivity.set(threadId, {
      activity,
      attention: attention ?? current?.attention ?? 0,
    });
    this.ctx.publish({
      threads: this.ctx.snapshot.threads.map((thread) => (thread.id === threadId ? { ...thread, activity, attention: attention ?? thread.attention } : thread)),
    });
  }

  async subscribeToSelectedThread(): Promise<void> {
    const threadId = this.ctx.selectedThreadId;
    if (threadId) await this.nativeDriver.ensureSubscription(threadId);
  }

  async refreshNativeTasks(threadId: string): Promise<void> {
    const tasks = await this.loadNativeTasks(threadId).catch(() => null);
    if (!tasks) return;
    const next = this.updateThreadState(threadId, (state) => ({ ...state, tasks }));
    if (threadId === this.ctx.selectedThreadId) this.ctx.publish({ workbench: this.workbenchFromState(next, null) });
  }

  /** Chat messages of one thread: the live snapshot when it is selected, otherwise recalled from storage. */
  async messagesFor(threadId: string): Promise<ChatMessage[]> {
    if (threadId === this.ctx.selectedThreadId) return this.ctx.snapshot.messages;
    return this.projector.mapMessages(await this.threadRepo.recall(threadId) as MastraMessage[]);
  }

  async syncMessagesSafely(threadId?: string, guard?: { selectionGeneration?: number; syncGeneration?: number }, assistantRunId?: string): Promise<boolean> {
    try {
      return await this.syncMessages(threadId, guard, assistantRunId);
    } catch (error) {
      this.ctx.reportError(error);
      return false;
    }
  }

  async refreshThreadSummaries(): Promise<void> {
    const threads = (await this.threadRepo.list())
      .map((thread) => {
        const summary = mapThread(thread);
        const activity = this.ctx.threadActivity.get(summary.id);
        return activity ? { ...summary, ...activity } : summary;
      })
      .sort(compareThreads);
    this.ctx.publish({ threads });
  }

  private async syncMessages(threadId = this.ctx.selectedThreadId ?? undefined, guard?: { selectionGeneration?: number; syncGeneration?: number }, assistantRunId?: string): Promise<boolean> {
    if (!threadId) {
      if (guard && ((guard.selectionGeneration !== undefined && guard.selectionGeneration !== this.ctx.threadSelectionGeneration) || (guard.syncGeneration !== undefined && guard.syncGeneration !== this.ctx.threadStateSyncGeneration))) return false;
      this.ctx.publish({ messages: [] });
      return true;
    }
    const rawMessages = await this.threadRepo.recall(threadId) as MastraMessage[];
    if (guard && ((guard.selectionGeneration !== undefined && guard.selectionGeneration !== this.ctx.threadSelectionGeneration) || (guard.syncGeneration !== undefined && guard.syncGeneration !== this.ctx.threadStateSyncGeneration))) return false;
    this.projector.recordPersistedAssistantIds(threadId, rawMessages);
    const messages = this.projector.mergeTransientMessages(threadId, this.projector.mapMessages(rawMessages), true);
    if (threadId === this.ctx.selectedThreadId) {
      this.ctx.publish({ messages });
    }
    return assistantRunId ? !this.ctx.assistantProjections.has(assistantRunId) : true;
  }

  async syncThreadState(options: { clearError?: boolean; threadId?: string } = {}, selectionGeneration = this.ctx.threadSelectionGeneration): Promise<void> {
    const syncGeneration = ++this.ctx.threadStateSyncGeneration;
    const projectSummaries = await loadProjectSummaries(this.projects);
    let threads = (await this.threadRepo.list())
      .map((thread) => {
        const summary = mapThread(thread);
        summary.workspace = scopeFor(summary.workspace.binding, projectSummaries);
        const activity = this.ctx.threadActivity.get(summary.id);
        return activity ? { ...summary, ...activity } : summary;
      })
      .sort(compareThreads);
    if (threads.length === 0) {
      threads = [mapThread(await this.threadRepo.create("New chat", {
        [THREAD_METADATA_KEY]: {
          workspaceBinding: { kind: "app" },
          modelSelection: this.defaultModelSelection(),
        },
      }))];
    }
    const wantedThreadId = options.threadId ?? this.ctx.selectedThreadId;
    const activeThreadId = wantedThreadId && threads.some((thread) => thread.id === wantedThreadId) ? wantedThreadId : threads[0].id;
    if (selectionGeneration !== this.ctx.threadSelectionGeneration || syncGeneration !== this.ctx.threadStateSyncGeneration || (this.ctx.pendingThreadSelectionId !== null && this.ctx.pendingThreadSelectionId !== activeThreadId)) return;
    // List first: a thread whose metadata cannot be read must not hide the others or abort startup.
    this.ctx.publish({ threads });
    let nextThreadState: PersistedThreadState;
    try {
      nextThreadState = activeThreadId ? await this.loadThreadState(activeThreadId) : {};
    } catch (error) {
      this.diagnostics.record({ source: "storage", type: "thread_state_load", phase: "error", threadId: activeThreadId, payload: error });
      if (selectionGeneration !== this.ctx.threadSelectionGeneration || syncGeneration !== this.ctx.threadStateSyncGeneration) return;
      this.keepSelectionAfterLoadFailure(threads);
      return;
    }
    if (selectionGeneration !== this.ctx.threadSelectionGeneration || syncGeneration !== this.ctx.threadStateSyncGeneration || (this.ctx.pendingThreadSelectionId !== null && this.ctx.pendingThreadSelectionId !== activeThreadId)) return;
    for (const [id, optimistic] of this.ctx.optimisticUserMessages) {
      if (optimistic.threadId !== activeThreadId) this.ctx.optimisticUserMessages.delete(id);
    }
    // Keep the thread we leave in the per-thread cache so background runs still find its state. The
    // selection changes only here (also for a newly created thread), after the target loaded, so no
    // save can write one thread's state under another id. The cache is the in-memory source of truth
    // until a write succeeds; persistThreadState rolls an entry back when the store refuses it.
    if (this.ctx.selectedThreadId && this.ctx.selectedThreadId !== activeThreadId && threads.some((thread) => thread.id === this.ctx.selectedThreadId)) this.ctx.threadStateCache.set(this.ctx.selectedThreadId, uiStateOf(this.ctx.threadState));
    this.ctx.selectedThreadId = activeThreadId;
    let modelSelection = resolveRememberedModelSelection(
      nextThreadState.modelSelection,
      this.ctx.preferredModelSelection,
      DEFAULT_MODEL_SELECTION,
    );
    if (modelSelection.providerId === "codex") {
      const migrated = migrateCodexSelection(modelSelection.modelId, modelSelection.reasoningEffort);
      modelSelection = { providerId: "codex", ...migrated };
    }
    const shouldBackfillModelSelection = !parseAppModelSelection(nextThreadState.modelSelection);
    this.ctx.threadState = shouldBackfillModelSelection
      ? { ...nextThreadState, modelSelection }
      : nextThreadState;
    const nextSnapshot: Partial<RuntimeSnapshot> = {
      threads,
      activeThreadId,
      selectedProviderId: modelSelection.providerId,
      selectedModelId: modelSelection.modelId,
      selectedReasoningEffort: modelSelection.reasoningEffort ?? null,
      projects: projectSummaries,
      activeWorkspace: scopeFor(this.ctx.threadState.workspaceBinding ?? { kind: "app" }, projectSummaries),
      messages: [],
      events: nextThreadState.events ?? [],
      interactions: nextThreadState.pendingInteractions ?? [],
      workbench: this.workbenchFromState(nextThreadState, null),
      continuation: nextThreadState.continuation ?? null,
      ...(nextThreadState.continuation
        ? {
            status: "running" as const,
            activeRun: { runId: nextThreadState.continuation.runId, threadId: nextThreadState.continuation.threadId, status: "running" as const },
          }
        : {}),
    };
    if (options.clearError !== false) nextSnapshot.error = null;
    this.ctx.publish(nextSnapshot);
    if (nextThreadState.continuation) this.armTimers();
    if (shouldBackfillModelSelection && activeThreadId) {
      await this.persistThreadState(activeThreadId, this.ctx.threadState);
    }
    await this.syncMessages(activeThreadId ?? undefined, {
      selectionGeneration,
      syncGeneration,
    });
  }

  /** The target thread could not be loaded: keep the previous selection, or clear it when that thread is gone, and surface the error. */
  private keepSelectionAfterLoadFailure(threads: ThreadSummary[]): void {
    const error = { code: "unknown" as const, message: THREAD_LOAD_FAILED, retryable: true };
    if (this.ctx.selectedThreadId && threads.some((thread) => thread.id === this.ctx.selectedThreadId)) {
      this.ctx.publish({ error });
      return;
    }
    this.ctx.selectedThreadId = null;
    this.ctx.threadState = {};
    this.ctx.publish({ activeThreadId: null, messages: [], events: [], interactions: [], continuation: null, workbench: this.workbenchFromState({}, null), error });
  }

  /** Drop everything cached for a thread that no longer exists. */
  forgetThread(threadId: string): void {
    this.ctx.threadStateCache.delete(threadId);
    this.savedState.delete(threadId);
  }

  private enqueueThreadSwitch(operation: () => Promise<void>): Promise<void> {
    const next = this.threadSwitchQueue.catch(() => undefined).then(operation);
    this.threadSwitchQueue = next.catch(() => undefined);
    return next;
  }

  private defaultModelSelection(): AppModelSelection {
    return this.ctx.preferredModelSelection ?? {
      providerId: this.ctx.snapshot.selectedProviderId,
      modelId: this.ctx.snapshot.selectedModelId,
      ...(this.ctx.snapshot.selectedReasoningEffort ? { reasoningEffort: this.ctx.snapshot.selectedReasoningEffort } : {}),
    };
  }

  nextPlanVersion(threadId: string): number {
    const state = this.stateFor(threadId);
    const versions = [...(state.pendingInteractions ?? []), ...(state.resolvedInteractions ?? [])].map((item) => item.plan?.version ?? 0);
    return Math.max(0, ...versions) + 1;
  }

  async createThread(title?: string, workspaceBinding: WorkspaceBinding = { kind: "app" }): Promise<string> {
    await this.ctx.ensureInitialized();
    if (this.ctx.startingRun || this.ctx.runId) throw makeRuntimeError("busy");
    if (workspaceBinding.kind === "project") {
      const project = (await loadProjectSummaries(this.projects)).find((item) => item.id === workspaceBinding.projectId);
      if (!project || project.availability !== "ready") throw new Error("The selected project folder is unavailable");
    }
    const state: PersistedThreadState = { workspaceBinding, modelSelection: this.defaultModelSelection() };
    const thread = await this.threadRepo.create(title?.trim() || "New chat", { [THREAD_METADATA_KEY]: state });
    this.ctx.threadStateCache.set(thread.id, state);
    await this.syncThreadState({ threadId: thread.id });
    if (this.ctx.selectedThreadId !== thread.id) throw new Error(THREAD_LOAD_FAILED);
    return thread.id;
  }

  async selectThread(threadId: string): Promise<void> {
    return this.ctx.enqueueComposerMutation(async () => {
      if (this.ctx.startingRun) throw makeRuntimeError("busy");
      const generation = ++this.ctx.threadSelectionGeneration;
      this.ctx.pendingThreadSelectionId = threadId;
      try {
        await this.ctx.ensureInitialized();
        const thread = await this.threadRepo.get(threadId);
        if (!thread) throw new Error("Conversation not found");
        if (generation !== this.ctx.threadSelectionGeneration) return;
        await this.enqueueThreadSwitch(async () => {
          if (generation !== this.ctx.threadSelectionGeneration) return;
          await this.syncThreadState({ threadId }, generation);
          // A superseded switch is not a failure; a target that failed to load must not subscribe or be reported as accepted.
          if (generation !== this.ctx.threadSelectionGeneration) return;
          if (this.ctx.selectedThreadId !== threadId) throw new Error(THREAD_LOAD_FAILED);
          await this.nativeDriver.ensureSubscription(threadId);
          if (generation === this.ctx.threadSelectionGeneration) this.ctx.pendingThreadSelectionId = null;
        });
      } finally {
        if (generation === this.ctx.threadSelectionGeneration && this.ctx.pendingThreadSelectionId === threadId) this.ctx.pendingThreadSelectionId = null;
      }
    });
  }

  async switchThread(threadId: string): Promise<void> {
    await this.selectThread(threadId);
  }

  async renameThread(threadId: string, title: string): Promise<void> {
    await this.ctx.ensureInitialized();
    if (this.ctx.startingRun || this.ctx.runId) throw makeRuntimeError("busy");
    const nextTitle = title.trim().slice(0, 80);
    if (!nextTitle) throw new Error("Conversation title cannot be empty");
    await this.threadRepo.rename(threadId, nextTitle);
    await this.syncThreadState();
  }

  async pinThread(threadId: string, pinned: boolean): Promise<void> {
    await this.ctx.ensureInitialized();
    const current = await this.threadRepo.get(threadId);
    if (!current) throw new Error("Conversation not found");
    const already = mapThread(current);
    // Re-pinning keeps the original pinnedAt, so a repeated request does not reorder the group.
    if (already.pinned === pinned) return;
    await this.threadRepo.setPinned(threadId, pinned ? new Date().toISOString() : null);
    await this.syncThreadState();
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.ctx.ensureInitialized();
    if (this.ctx.startingRun || this.ctx.runId) throw makeRuntimeError("busy");
    await this.threadRepo.delete(threadId);
    this.forgetThread(threadId);
    this.taskToolPolicy.reset(threadId);
    this.nativeDriver.dispose(threadId);
    const remaining = (await this.threadRepo.list()).map(mapThread).sort(compareThreads);
    if (this.ctx.selectedThreadId === threadId || !this.ctx.selectedThreadId) {
      const next = remaining[0] ?? mapThread(await this.threadRepo.create("New chat", {
        [THREAD_METADATA_KEY]: {
          workspaceBinding: { kind: "app" },
          modelSelection: this.defaultModelSelection(),
        },
      }));
      await this.syncThreadState({ threadId: next.id });
      return;
    }
    await this.syncThreadState();
  }
}
