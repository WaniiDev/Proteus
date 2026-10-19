import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { MastraCodeGateway } from "@mastra/code-sdk/agents/mastracode-gateway";
import { Mastra } from "@mastra/core/mastra";
import { Memory } from "@mastra/memory";
import { LocalFilesystem, Workspace, WORKSPACE_TOOLS } from "@mastra/core/workspace";
import { Utils } from "electrobun/bun";
import type { DiagnosticsSnapshot, InteractionResponseResult, MemoryCategory, MemoryScope, MemorySettingsState, ProviderId, ProviderModelId, ReasoningEffort, RuntimeError, RuntimeSnapshot, WorkspaceBinding, WorkspaceBindingUpdateResult } from "../shared/contracts";
import { createCodexCredentialStore, createCredentialVault, ensureUserDataDirectory, type CodexCredentialStore, type CredentialVault } from "./credentials";
import { openRouterGateway } from "./openrouter";
import { applyToolOutcomes, upsertChatMessage, upsertPendingInteraction, parseSuspendedInteraction, parseToolApproval } from "./runtime-projection";
import { TaskToolPolicy } from "./task-tool-policy";
import { cutOverLegacyRuntimeData } from "./runtime-cutover";
import { createProteusCodexCatalogProvider } from "./codex-models";
import { RuntimeDiagnostics, type DiagnosticInput } from "./diagnostics";
import { createProteusStorage, type ProteusStorageFoundation } from "./mastra-foundation";
import { ensureProteusAppWorkspace, proteusAppWorkspaceRoot } from "./app-workspace";
import { NativeThreadRepository } from "./native-thread-repository";
import { NativeAgentDriver, type NativeQueueAgent } from "./native-agent-driver";
import type { NativeAgentChunk, NativeStreamProjection } from "./native-stream-projection";
import { WorkspaceRegistry } from "./workspace-registry";
import { ScopedMemoryManager } from "./scoped-memory";
import { MAX_INPUT_LENGTH, RESOURCE_ID } from "./runtime/constants";
import { chatRole, extractText } from "./runtime/message-mapping";
import type { MastraMessage, PersistedThreadState, SnapshotListener } from "./runtime/types";
import { makeRuntimeError, normalizeError } from "./runtime-error-mapping";
import { RuntimeContext } from "./runtime/context";
import { createProteusAgent } from "./runtime/agent-factory";
import { MessageProjector } from "./runtime/message-projector";
import { ThreadService } from "./runtime/thread-service";
import { ContinuationService } from "./runtime/continuation-service";
import { InteractionService } from "./runtime/interaction-service";
import { WorkspaceService } from "./runtime/workspace-service";
import { ProviderService } from "./runtime/provider-service";
import { MemoryService } from "./runtime/memory-service";

/** Public entry point of the Mastra-backed text runtime; the services in runtime/ own the behaviour. */

export class TextRuntime {

  private readonly ctx = new RuntimeContext();
  private readonly nativeDriver: NativeAgentDriver;
  private readonly threadRepo: NativeThreadRepository;
  private readonly memory: Memory;

  private readonly diagnostics: RuntimeDiagnostics;
  private readonly appStorage: ProteusStorageFoundation["appStorage"];
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly mastra: Mastra;
  private readonly projector: MessageProjector;
  private readonly threads: ThreadService;
  private readonly continuation: ContinuationService;
  private readonly interactions: InteractionService;
  private readonly workspaces: WorkspaceService;
  private readonly providers: ProviderService;
  private readonly memories: MemoryService;
  private initializePromise: Promise<RuntimeSnapshot> | undefined;
  private shutdownPromise: Promise<void> | null = null;



  constructor(vault: CredentialVault = createCredentialVault(), codexCredentialStore: CodexCredentialStore = createCodexCredentialStore()) {
    this.diagnostics = new RuntimeDiagnostics(Utils.paths.userData);
    const codexGateway = new MastraCodeGateway({
      mastraGatewayBaseUrl: "https://gateway-api.mastra.ai",
      routeThroughMastraGateway: false,
      thinkingLevel: "medium",
      credentialStore: codexCredentialStore,
    });
    const codexCatalogProvider = createProteusCodexCatalogProvider(codexGateway);
    const storageFoundation = createProteusStorage(Utils.paths.userData);
    const storage = storageFoundation.storage;
    this.appStorage = storageFoundation.appStorage;
    const modelPreferences = storageFoundation.modelPreferences;
    const projects = storageFoundation.projects;
    const scopedMemory = new ScopedMemoryManager(storage, storageFoundation.memorySettings);
    const planFilesystem = new LocalFilesystem({
      basePath: join(Utils.paths.userData, "proteus-plans-v2"),
      contained: true,
      instructions: "Plan files are private Proteus Markdown drafts. Use relative .md paths only.",
    });
    const workspace = new Workspace({
      id: "proteus-plan-workspace",
      name: "Proteus plan drafts",
      filesystem: planFilesystem,
      tools: {
        enabled: false,
        [WORKSPACE_TOOLS.FILESYSTEM.READ_FILE]: { enabled: true, name: "read_plan" },
        [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: { enabled: true, name: "write_plan", requireApproval: false, requireReadBeforeWrite: false },
      },
    });
    this.workspaceRegistry = new WorkspaceRegistry(Utils.paths.userData);
    const memory = new Memory({
      storage: storage,
      vector: false,
      options: {
        lastMessages: 20,
        semanticRecall: false,
        generateTitle: true,
      },
    });
    const threadRepo = new NativeThreadRepository(memory, RESOURCE_ID);
    const taskToolPolicy = new TaskToolPolicy();
    const agent = createProteusAgent({ ctx: this.ctx, vault, codexCredentialStore, workspaceRegistry: this.workspaceRegistry, memory, scopedMemory, workspace, taskToolPolicy, diagnostics: this.diagnostics });
    const nativeDriver = new NativeAgentDriver(agent as unknown as NativeQueueAgent, RESOURCE_ID, {
      onProjection: (projection, chunk) => this.handleNativeProjection(projection, chunk),
      onQueueChanged: (threadId) => {
        if (threadId === this.ctx.selectedThreadId) this.ctx.publish({ workbench: this.threads.workbenchFromState(this.ctx.threadState, null) });
      },
      onError: (error, threadId) => this.handleNativeDriverError(error, threadId),
      onClose: (threadId, activeRunId) => this.handleNativeDriverClose(threadId, activeRunId),
    });

    const ctx = this.ctx;
    this.projector = new MessageProjector(ctx);
    this.threads = new ThreadService(ctx, { projector: this.projector, storage, nativeDriver, threadRepo, diagnostics: this.diagnostics, projects, planFilesystem, taskToolPolicy, armTimers: () => this.continuation.armContinuationTimers() });
    this.continuation = new ContinuationService(ctx, { nativeDriver, diagnostics: this.diagnostics, threads: this.threads });
    this.workspaces = new WorkspaceService(ctx, { projects, scopedMemory, workspaceRegistry: this.workspaceRegistry, appWorkspaceRoot: proteusAppWorkspaceRoot(Utils.paths.userData), nativeDriver, threadRepo, threads: this.threads });
    this.interactions = new InteractionService(ctx, { nativeDriver, diagnostics: this.diagnostics, planFilesystem, threads: this.threads, workspaces: this.workspaces, continuation: this.continuation, projector: this.projector });
    this.providers = new ProviderService(ctx, { vault, codexCredentialStore, codexCatalogProvider, modelPreferences, threads: this.threads, abortRun: () => this.abort() });
    this.memories = new MemoryService(ctx, { projects, scopedMemory });
    this.nativeDriver = nativeDriver;
    this.threadRepo = threadRepo;
    this.memory = memory;
    ctx.ensureInitialized = async () => { await this.initialize(); };

    this.mastra = new Mastra({
      storage,
      agents: { proteus: agent },
      gateways: { "models.dev": openRouterGateway, mastracode: codexGateway },
      logger: false,
    });
  }



  onSnapshot(listener: SnapshotListener): () => void {
    return this.ctx.onSnapshot(listener);
  }

  getSnapshot(): RuntimeSnapshot {
    return this.ctx.getSnapshot();
  }

  reportError(error: unknown): void {
    this.ctx.reportError(error);
  }

  /** Release the Mastra-owned workspace, event engine, and storage handles once. */
  shutdown(): Promise<void> {
    this.shutdownPromise ??= (async () => {
      this.continuation.clearContinuationTimers();
      try {
        await this.mastra.shutdown();
      } finally {
        await this.workspaceRegistry.destroy();
        await this.appStorage.close();
      }
    })();
    return this.shutdownPromise;
  }

  getDiagnostics(limit?: number): DiagnosticsSnapshot {
    return this.diagnostics.snapshot(limit);
  }

  setDiagnosticsEnabled(enabled: boolean): DiagnosticsSnapshot {
    return this.diagnostics.setEnabled(enabled);
  }

  clearDiagnostics(): Promise<DiagnosticsSnapshot> {
    return this.diagnostics.clear();
  }

  async exportDiagnostics(): Promise<{ path: string }> {
    return { path: await this.diagnostics.export() };
  }

  traceDiagnostic(input: DiagnosticInput): void {
    this.diagnostics.record(input);
  }

  private handleNativeProjection(projection: NativeStreamProjection, chunk: NativeAgentChunk): void {
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

  private handleNativeDriverError(error: unknown, threadId: string): void {
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

  private handleNativeDriverClose(threadId: string, activeRunId: string | null): void {
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

  async initialize(): Promise<RuntimeSnapshot> {
    this.initializePromise ??= (async () => {
      try {
        const userDataRoot = await ensureUserDataDirectory();
        await ensureProteusAppWorkspace(userDataRoot);
        await this.appStorage.init();
        await this.providers.loadModelPreferences();
        await this.diagnostics.initialize();
        await cutOverLegacyRuntimeData(Utils.paths.userData);
        await this.threads.syncThreadState();
        await this.threads.subscribeToSelectedThread();
        if (this.ctx.threadState.continuation) await this.continuation.reconcileContinuation("startup");
        await this.providers.refreshCodexModels();
        await this.providers.validateStoredCredential();
        return this.ctx.getSnapshot();
      } catch (error) {
        const normalized = normalizeError(error);
        this.ctx.publish({ status: "error", error: normalized });
        return this.ctx.getSnapshot();
      }
    })();
    return this.initializePromise;
  }

  async connectProvider(providerId: ProviderId, options: { apiKey?: string; mode?: "api-key" | "browser" | "device" }): Promise<void> {
    return this.providers.connectProvider(providerId, options);
  }

  async submitProviderAuth(providerId: ProviderId, value: string): Promise<void> {
    return this.providers.submitProviderAuth(providerId, value);
  }

  async cancelProviderAuth(providerId: ProviderId): Promise<void> {
    return this.providers.cancelProviderAuth(providerId);
  }

  async disconnectProvider(providerId: ProviderId): Promise<void> {
    return this.providers.disconnectProvider(providerId);
  }

  async connect(apiKey: string): Promise<void> {
    return this.providers.connect(apiKey);
  }

  async disconnect(): Promise<void> {
    return this.providers.disconnect();
  }

  async refreshModels(): Promise<void> {
    return this.providers.refreshModels();
  }

  async selectProvider(providerId: ProviderId): Promise<void> {
    return this.providers.selectProvider(providerId);
  }

  async selectModel(modelId: ProviderModelId): Promise<void> {
    return this.providers.selectModel(modelId);
  }

  async selectReasoning(reasoningEffort: ReasoningEffort | null): Promise<void> {
    return this.providers.selectReasoning(reasoningEffort);
  }

  async selectWorkspace(workspaceBinding: WorkspaceBinding): Promise<WorkspaceBindingUpdateResult> {
    return this.workspaces.selectWorkspace(workspaceBinding);
  }

  async workspaceTree(path?: string, depth?: number, includeHidden?: boolean) { return this.workspaceRegistry.tree(await this.workspaces.selectedWorkspaceRoot(), path, depth, includeHidden); }

  async workspaceRead(path: string, lineStart?: number, lineEnd?: number) { return this.workspaceRegistry.read(await this.workspaces.selectedWorkspaceRoot(), path, lineStart, lineEnd); }

  async workspaceWrite(path: string, content: string, expectedVersion?: string) { return this.workspaceRegistry.write(await this.workspaces.selectedWorkspaceRoot(), path, content, expectedVersion); }

  async workspaceCreateDirectory(path: string) { await this.workspaceRegistry.createDirectory(await this.workspaces.selectedWorkspaceRoot(), path); return { accepted: true as const }; }

  async workspaceDelete(path: string) { await this.workspaceRegistry.delete(await this.workspaces.selectedWorkspaceRoot(), path); return { accepted: true as const }; }

  async workspaceMove(from: string, to: string) { await this.workspaceRegistry.move(await this.workspaces.selectedWorkspaceRoot(), from, to); return { accepted: true as const }; }

  async workspaceCopy(from: string, to: string) { await this.workspaceRegistry.copy(await this.workspaces.selectedWorkspaceRoot(), from, to); return { accepted: true as const }; }

  async workspaceSearch(query: string, options?: { mode?: "bm25" | "vector" | "hybrid"; topK?: number; minScore?: number; vectorWeight?: number }) { return this.workspaceRegistry.search(await this.workspaces.selectedWorkspaceRoot(), query, options); }

  async workspaceIndex(paths: string[]) { return this.workspaceRegistry.index(await this.workspaces.selectedWorkspaceRoot(), paths); }

  async workspaceSkills(load?: boolean) { return this.workspaceRegistry.skills(await this.workspaces.selectedWorkspaceRoot(), load); }

  async createThread(title?: string, workspaceBinding: WorkspaceBinding = { kind: "app" }): Promise<string> {
    return this.threads.createThread(title, workspaceBinding);
  }

  async getMemoryState(scope?: MemoryScope): Promise<MemorySettingsState> {
    return this.memories.getMemoryState(scope);
  }

  async setMemoryEnabled(enabled: boolean): Promise<MemorySettingsState> {
    return this.memories.setMemoryEnabled(enabled);
  }

  async createMemory(scope: MemoryScope, category: MemoryCategory, content: string): Promise<MemorySettingsState> {
    return this.memories.createMemory(scope, category, content);
  }

  async updateMemory(scope: MemoryScope, id: string, category: MemoryCategory, content: string): Promise<MemorySettingsState> {
    return this.memories.updateMemory(scope, id, category, content);
  }

  async deleteMemory(scope: MemoryScope, id: string): Promise<MemorySettingsState> {
    return this.memories.deleteMemory(scope, id);
  }

  async resetMemory(scope: MemoryScope): Promise<MemorySettingsState> {
    return this.memories.resetMemory(scope);
  }

  async attachProject(projectId?: string): Promise<boolean> {
    return this.workspaces.attachProject(projectId);
  }

  async removeProject(projectId: string): Promise<void> {
    return this.workspaces.removeProject(projectId);
  }

  async openProject(projectId: string): Promise<void> {
    return this.workspaces.openProject(projectId);
  }

  async selectThread(threadId: string): Promise<void> {
    return this.threads.selectThread(threadId);
  }

  async switchThread(threadId: string): Promise<void> {
    return this.threads.switchThread(threadId);
  }

  async renameThread(threadId: string, title: string): Promise<void> {
    return this.threads.renameThread(threadId, title);
  }

  async deleteThread(threadId: string): Promise<void> {
    return this.threads.deleteThread(threadId);
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

  async respondToInteraction(toolCallId: string, response: unknown): Promise<InteractionResponseResult> {
    return this.interactions.respondToInteraction(toolCallId, response);
  }

  async dismissInteraction(toolCallId: string): Promise<InteractionResponseResult> {
    return this.interactions.dismissInteraction(toolCallId);
  }

  async respondToToolApproval(toolCallId: string, approved: boolean, fingerprint: string): Promise<InteractionResponseResult> {
    return this.interactions.respondToToolApproval(toolCallId, approved, fingerprint);
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
    } catch (error) {
      // A clone nobody will ever open must not linger as an orphan "· retry" conversation.
      this.ctx.threadStateCache.delete(retryThread.id);
      await this.threadRepo.delete(retryThread.id).catch(() => undefined);
      throw error;
    }
    await this.threads.syncThreadState({ threadId: retryThread.id });
    if (this.ctx.startingRunAbortRequested) throw makeRuntimeError("aborted");
    this.ctx.retryingText = null;
    this.ctx.hideSingleRetry = false;
    return this.queueNativeMessage(retryThread.id, content, { optimistic: true });
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
      this.continuation.clearContinuationTimers();
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
    this.continuation.clearContinuationTimers();
    this.ctx.releaseRun(runId);
    if (threadId) this.threads.updateThreadActivity(threadId, "interrupted", 0);
    if (!threadId || this.ctx.selectedThreadId === threadId) this.ctx.publish({ status: this.ctx.idleStatus(), activeRun: null, error: this.ctx.runError });
  }
}
