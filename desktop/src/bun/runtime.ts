import { join } from "node:path";
import { MastraCodeGateway } from "@mastra/code-sdk/agents/mastracode-gateway";
import { Mastra } from "@mastra/core/mastra";
import { Memory } from "@mastra/memory";
import { LocalFilesystem, Workspace, WORKSPACE_TOOLS } from "@mastra/core/workspace";
import { Utils } from "electrobun/bun";
import type { AnswerIntentParams, AnswerIntentResult, DiagnosticsSnapshot, InteractionResponseResult, MemoryCategory, MemoryScope, MemorySettingsState, ProviderId, ProviderModelId, ReasoningEffort, RuntimeSnapshot, WorkspaceBinding, WorkspaceBindingUpdateResult } from "../shared/contracts";
import { createAnthropicCredentialVault, createCodexCredentialStore, createCredentialVault, ensureUserDataDirectory, type CodexCredentialStore, type CredentialVault } from "./providers/credentials";
import { openRouterGateway } from "./providers/openrouter";
import { TaskToolPolicy } from "./tools/task-tool-policy";
import { cutOverLegacyRuntimeData } from "./core/runtime-cutover";
import { createProteusCodexCatalogProvider } from "./providers/codex-models";
import { RuntimeDiagnostics, type DiagnosticInput } from "./core/diagnostics";
import { createProteusStorage, type ProteusStorageFoundation } from "./core/mastra-foundation";
import { ensureProteusAppWorkspace, proteusAppWorkspaceRoot } from "./workspace/app-workspace";
import { NativeThreadRepository } from "./native/native-thread-repository";
import { NativeAgentDriver, type NativeQueueAgent } from "./native/native-agent-driver";
import { WorkspaceRegistry } from "./workspace/workspace-registry";
import { ScopedMemoryManager } from "./memory/scoped-memory";
import { RESOURCE_ID } from "./runtime/constants";
import type { SnapshotListener } from "./runtime/types";
import { normalizeError } from "./core/runtime-error-mapping";
import { RuntimeContext } from "./runtime/context";
import { createProteusAgent } from "./runtime/agent-factory";
import { MessageProjector } from "./runtime/message-projector";
import { ThreadService } from "./runtime/thread-service";
import { ContinuationService } from "./runtime/continuation-service";
import { InteractionService } from "./runtime/interaction-service";
import { WorkspaceService } from "./runtime/workspace-service";
import { ProviderService } from "./runtime/provider-service";
import { MemoryService } from "./runtime/memory-service";
import { RunCoordinator } from "./runtime/run-coordinator";
import { AnswerIntentService } from "./runtime/answer-intent-service";

/** Public entry point of the Mastra-backed text runtime; the services in runtime/ own the behaviour. */

export class TextRuntime {
  private readonly ctx = new RuntimeContext();

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
  private readonly runs: RunCoordinator;
  private readonly answerIntents: AnswerIntentService;
  private initializePromise: Promise<RuntimeSnapshot> | undefined;
  private shutdownPromise: Promise<void> | null = null;

  constructor(vault: CredentialVault = createCredentialVault(), codexCredentialStore: CodexCredentialStore = createCodexCredentialStore(), anthropicVault: CredentialVault = createAnthropicCredentialVault()) {
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
    const agent = createProteusAgent({ ctx: this.ctx, vault, anthropicVault, codexCredentialStore, workspaceRegistry: this.workspaceRegistry, memory, scopedMemory, workspace, taskToolPolicy, diagnostics: this.diagnostics });
    const nativeDriver = new NativeAgentDriver(agent as unknown as NativeQueueAgent, RESOURCE_ID, {
      onProjection: (projection, chunk) => this.runs.handleNativeProjection(projection, chunk),
      onQueueChanged: (threadId) => {
        if (threadId === this.ctx.selectedThreadId) this.ctx.publish({ workbench: this.threads.workbenchFromState(this.ctx.threadState, null) });
      },
      onError: (error, threadId) => this.runs.handleNativeDriverError(error, threadId),
      onClose: (threadId, activeRunId) => this.runs.handleNativeDriverClose(threadId, activeRunId),
    });

    const ctx = this.ctx;
    this.projector = new MessageProjector(ctx);
    this.threads = new ThreadService(ctx, { projector: this.projector, storage, nativeDriver, threadRepo, diagnostics: this.diagnostics, projects, planFilesystem, taskToolPolicy, armTimers: () => this.continuation.armContinuationTimers() });
    this.continuation = new ContinuationService(ctx, { nativeDriver, diagnostics: this.diagnostics, threads: this.threads });
    this.workspaces = new WorkspaceService(ctx, { projects, scopedMemory, workspaceRegistry: this.workspaceRegistry, appWorkspaceRoot: proteusAppWorkspaceRoot(Utils.paths.userData), nativeDriver, threadRepo, threads: this.threads });
    this.interactions = new InteractionService(ctx, { nativeDriver, diagnostics: this.diagnostics, planFilesystem, threads: this.threads, workspaces: this.workspaces, continuation: this.continuation, projector: this.projector });
    this.providers = new ProviderService(ctx, { vault, anthropicVault, codexCredentialStore, codexCatalogProvider, modelPreferences, threads: this.threads, abortRun: () => this.runs.abort() });
    this.memories = new MemoryService(ctx, { projects, scopedMemory });
    this.runs = new RunCoordinator(ctx, { nativeDriver, diagnostics: this.diagnostics, memory, threadRepo, threads: this.threads, workspaces: this.workspaces, interactions: this.interactions, continuation: this.continuation, projector: this.projector });
    this.answerIntents = new AnswerIntentService(ctx, { threads: this.threads, workspaceRegistry: this.workspaceRegistry, workspaces: this.workspaces, runs: this.runs, diagnostics: this.diagnostics });
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
        await this.providers.refreshAnthropicModels();
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

  async pinThread(threadId: string, pinned: boolean): Promise<void> {
    return this.threads.pinThread(threadId, pinned);
  }

  async deleteThread(threadId: string): Promise<void> {
    try {
      await this.threads.deleteThread(threadId);
    } finally {
      this.continuation.forgetThread(threadId);
    }
  }

  async send(text: string, clientMessageId?: string): Promise<{ runId: string }> {
    return this.runs.send(text, clientMessageId);
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

  async runAnswerIntent(params: AnswerIntentParams): Promise<AnswerIntentResult> {
    return this.answerIntents.run(params);
  }

  async retry(messageId: string): Promise<{ runId: string }> {
    return this.runs.retry(messageId);
  }

  async continueFrom(messageId: string): Promise<{ runId: string }> {
    return this.runs.continueFrom(messageId);
  }

  abort(): void {
    return this.runs.abort();
  }
}
