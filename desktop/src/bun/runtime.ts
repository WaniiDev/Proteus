import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Agent } from "@mastra/core/agent";
import { AgentController, type AgentControllerEvent, type AgentControllerThread } from "@mastra/core/agent-controller";
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { LocalFilesystem, Workspace } from "@mastra/core/workspace";
import { Utils } from "electrobun/bun";
import type {
  ChatMessage,
  OpenRouterModelId,
  ProviderErrorCode,
  RuntimeError,
  RuntimeSnapshot,
  ThreadSummary,
} from "../shared/contracts";
import { createCredentialVault, ensureUserDataDirectory, SecureStoreUnavailableError, type CredentialVault } from "./credentials";
import { getOpenRouterErrorStatus, isOpenRouterModelId, listOpenRouterTextModels, validateOpenRouterKey } from "./openrouter";

const CONTROLLER_ID = "proteus-text-controller";
const AGENT_ID = "proteus-text-agent";
const RESOURCE_ID = "local-user";
const SESSION_ID = "proteus-desktop-session";
const SESSION_STATE_FILE = "proteus-session.json";
const DEFAULT_MODEL_ID: OpenRouterModelId = "openrouter/auto";
const MAX_INPUT_LENGTH = 32_000;

const USER_FACING_ERRORS: Record<ProviderErrorCode, { message: string; retryable: boolean }> = {
  "invalid-credential": { message: "That OpenRouter key is invalid or disabled.", retryable: false },
  "insufficient-credits": { message: "OpenRouter needs credits before this request can run.", retryable: false },
  forbidden: { message: "OpenRouter refused this request for the current account.", retryable: false },
  "model-unavailable": { message: "The selected OpenRouter model is unavailable.", retryable: true },
  "context-too-large": { message: "This conversation is too large for the selected model. Start a new chat or shorten the message.", retryable: false },
  "rate-limited": { message: "OpenRouter is rate-limiting requests. Try again shortly.", retryable: true },
  timeout: { message: "OpenRouter took too long to respond.", retryable: true },
  offline: { message: "OpenRouter could not be reached. Check your connection and retry.", retryable: true },
  aborted: { message: "The response was stopped.", retryable: true },
  busy: { message: "A response is already running.", retryable: true },
  "secure-store-unavailable": { message: "Windows Credential Manager is unavailable, so PROTEUS cannot use a key safely.", retryable: false },
  "catalog-unavailable": { message: "The OpenRouter model catalog could not be refreshed.", retryable: true },
  unknown: { message: "The text model could not complete this request.", retryable: true },
};

type SnapshotListener = (snapshot: RuntimeSnapshot) => void;
type MastraMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "signal";
  createdAt: Date;
  content?: unknown;
  metadata?: { signal?: { type?: string } };
};

type ControllerContext = {
  session?: { modelId?: string };
};

function isoDate(value: Date | string | number | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  return new Date().toISOString();
}

function extractText(message: MastraMessage): string {
  const content = message.content;
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part === "string" ? part : extractPartText(part))
      .filter(Boolean)
      .join("");
  }
  if (typeof content !== "object") return "";
  const record = content as { content?: unknown; parts?: unknown };
  if (typeof record.content === "string") return record.content;
  return (Array.isArray(record.parts) ? record.parts : [])
    .map((part) => extractPartText(part))
    .filter(Boolean)
    .join("");
}

function extractPartText(part: unknown): string {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  const record = part as { type?: unknown; text?: unknown; content?: unknown };
  if (record.type !== undefined && record.type !== "text") return "";
  return typeof record.text === "string" ? record.text : typeof record.content === "string" ? record.content : "";
}

function chatRole(message: MastraMessage): ChatMessage["role"] | null {
  if (message.role === "assistant") return "assistant";
  if (message.role === "user") return "user";
  if (message.role === "signal") {
    const content = message.content;
    const contentMetadata = content && typeof content === "object" && !Array.isArray(content)
      ? (content as { metadata?: { signal?: { type?: string } } }).metadata
      : undefined;
    if (contentMetadata?.signal?.type === "user" || message.metadata?.signal?.type === "user") return "user";
  }
  return null;
}

function modelFromSession(value: string | undefined): OpenRouterModelId {
  return value && isOpenRouterModelId(value) ? value : DEFAULT_MODEL_ID;
}

function makeRuntimeError(code: ProviderErrorCode): RuntimeError {
  const details = USER_FACING_ERRORS[code];
  return { code, message: details.message, retryable: details.retryable };
}

function findStatus(error: unknown): number | undefined {
  const direct = getOpenRouterErrorStatus(error);
  if (direct !== undefined) return direct;
  if (error && typeof error === "object") {
    const record = error as { statusCode?: unknown; response?: { status?: unknown }; cause?: unknown };
    if (typeof record.statusCode === "number") return record.statusCode;
    if (typeof record.response?.status === "number") return record.response.status;
    if (record.cause !== undefined) return findStatus(record.cause);
  }
  return undefined;
}

function findMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "";
}

function normalizeError(error: unknown): RuntimeError {
  if (error && typeof error === "object" && "code" in error && "message" in error && "retryable" in error) {
    return error as RuntimeError;
  }
  if (error instanceof SecureStoreUnavailableError) return makeRuntimeError("secure-store-unavailable");

  const status = findStatus(error);
  if (status === 401) return makeRuntimeError("invalid-credential");
  if (status === 402) return makeRuntimeError("insufficient-credits");
  if (status === 403) return makeRuntimeError("forbidden");
  if (status === 404) return makeRuntimeError("model-unavailable");
  if (status === 408) return makeRuntimeError("timeout");
  if (status === 429) return makeRuntimeError("rate-limited");
  if (status === 400 && /context|token|length/i.test(findMessage(error))) return makeRuntimeError("context-too-large");
  if (status && status >= 500) return makeRuntimeError("offline");

  const message = findMessage(error);
  if (/no verified|api key|credential/i.test(message)) return makeRuntimeError("invalid-credential");
  if (/abort|cancel/i.test(message)) return makeRuntimeError("aborted");
  if (/network|fetch|connect|socket|offline|timed out/i.test(message)) return makeRuntimeError("offline");
  return makeRuntimeError("unknown");
}

function mapThread(thread: AgentControllerThread): ThreadSummary {
  return {
    id: thread.id,
    title: thread.title?.trim() || "New chat",
    createdAt: isoDate(thread.createdAt),
    updatedAt: isoDate(thread.updatedAt),
  };
}

export class TextRuntime {
  private readonly vault: CredentialVault;
  private readonly listeners = new Set<SnapshotListener>();
  private readonly storage: LibSQLStore;
  private readonly memory: Memory;
  private readonly workspace: Workspace;
  private readonly agent: Agent;
  private readonly controller: AgentController;
  private session: Awaited<ReturnType<AgentController["createSession"]>> | undefined;
  private snapshot: RuntimeSnapshot = {
    status: "booting",
    credential: { configured: false, verified: false },
    models: [
      {
        id: DEFAULT_MODEL_ID,
        rawId: "auto",
        name: "Auto Router",
        description: "Let OpenRouter choose a suitable text model for each request.",
        inputModalities: ["text"],
        outputModalities: ["text"],
      },
    ],
    selectedModelId: DEFAULT_MODEL_ID,
    threads: [],
    activeThreadId: null,
    messages: [],
    activeRun: null,
    error: null,
  };
  private runId: string | null = null;
  private runOutcome: "streaming" | "complete" | "interrupted" | "error" = "complete";
  private runError: RuntimeError | null = null;
  private lastAssistantId: string | null = null;
  private messageSyncTimer: ReturnType<typeof setTimeout> | undefined;
  private initializePromise: Promise<RuntimeSnapshot> | undefined;

  constructor(vault: CredentialVault = createCredentialVault()) {
    this.vault = vault;
    this.storage = new LibSQLStore({ id: "proteus-storage", url: `file:${join(Utils.paths.userData, "proteus.db")}` });
    this.workspace = new Workspace({
      id: "proteus-text-workspace",
      name: "PROTEUS text chat",
      filesystem: new LocalFilesystem({ basePath: Utils.paths.userData, readOnly: true, instructions: "" }),
    });
    this.memory = new Memory({
      storage: this.storage,
      vector: false,
      options: { lastMessages: 20, semanticRecall: false, generateTitle: false },
    });

    this.agent = new Agent({
      id: AGENT_ID,
      name: "PROTEUS",
      instructions: "You are PROTEUS, a personal AI companion. Respond directly and helpfully in text. You have no tools and must never claim to have taken external actions. If the user asks for an action you cannot perform, explain that limitation. Use the user’s language when clear; default to English.",
      model: async ({ requestContext }) => {
        const controllerContext = requestContext.get("controller") as ControllerContext | undefined;
        const modelId = modelFromSession(controllerContext?.session?.modelId ?? this.snapshot.selectedModelId);
        const apiKey = await this.vault.get();
        if (!apiKey) throw new Error("No verified OpenRouter credential");
        return { id: modelId, apiKey };
      },
    });

    this.controller = new AgentController({
      id: CONTROLLER_ID,
      resourceId: RESOURCE_ID,
      storage: this.storage,
      memory: this.memory,
      workspace: this.workspace,
      agent: this.agent,
      defaultModeId: "chat",
      modes: [{ id: "chat", name: "Chat", defaultModelId: DEFAULT_MODEL_ID, availableTools: [] }],
      disableBuiltinTools: ["ask_user", "submit_plan", "task_write", "task_update", "task_complete", "task_check", "subagent"],
    });

    new Mastra({
      storage: this.storage,
      agents: { proteus: this.agent },
      agentControllers: { proteus: this.controller },
      logger: false,
    });
  }

  onSnapshot(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): RuntimeSnapshot {
    return structuredClone(this.snapshot);
  }

  reportError(error: unknown): void {
    const normalized = error && typeof error === "object" && "code" in error && "message" in error
      ? error as RuntimeError
      : normalizeError(error);
    this.publish({ error: normalized });
  }

  private publish(next: Partial<RuntimeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private requireSession() {
    if (!this.session) throw new Error("Text runtime is not initialized");
    return this.session;
  }

  private async ensureInitialized() {
    await this.initialize();
    return this.requireSession();
  }

  private async readPersistedThreadId(): Promise<string | undefined> {
    try {
      const value = JSON.parse(await readFile(join(Utils.paths.userData, SESSION_STATE_FILE), "utf8")) as { activeThreadId?: unknown };
      return typeof value.activeThreadId === "string" && value.activeThreadId.length > 0 ? value.activeThreadId : undefined;
    } catch {
      return undefined;
    }
  }

  private async restoreableThreadId(candidate: string | undefined): Promise<string | undefined> {
    if (!candidate) return undefined;
    try {
      const memoryStore = await this.storage.getStore("memory");
      const thread = await memoryStore?.getThreadById({ threadId: candidate, resourceId: RESOURCE_ID });
      return thread?.id === candidate ? candidate : undefined;
    } catch {
      return undefined;
    }
  }

  private async persistActiveThread(): Promise<void> {
    const threadId = this.session?.thread.getId();
    if (!threadId) return;
    try {
      await writeFile(join(Utils.paths.userData, SESSION_STATE_FILE), `${JSON.stringify({ activeThreadId: threadId })}\n`, "utf8");
    } catch {
      // Thread restoration is best effort and must never block chat.
    }
  }

  private subscribeToController(): void {
    const session = this.requireSession();
    session.subscribe((event) => this.handleControllerEvent(event));
  }

  private handleControllerEvent(event: AgentControllerEvent): void {
    if (event.type === "agent_start") {
      this.runOutcome = "streaming";
      this.runError = null;
      this.publish({ status: "running" });
      return;
    }

    if (event.type === "error") {
      const normalized = normalizeError(event.error);
      this.runOutcome = normalized.code === "aborted" ? "interrupted" : "error";
      this.runError = normalized;
      if (this.runId) {
        this.publish({
          activeRun: { runId: this.runId, status: this.runOutcome === "interrupted" ? "aborted" : "error" },
          error: normalized,
        });
      }
      return;
    }

    if (event.type === "agent_end") {
      if (this.runOutcome !== "error" && this.runOutcome !== "interrupted") {
        this.runOutcome = event.reason === "aborted" ? "interrupted" : event.reason === "error" ? "error" : "complete";
      }
      if (this.runOutcome === "interrupted" && !this.runError) this.runError = makeRuntimeError("aborted");
      if (this.runOutcome === "error" && !this.runError) this.runError = makeRuntimeError("unknown");
      if (this.runId && this.runError) {
        this.publish({
          activeRun: { runId: this.runId, status: this.runOutcome === "interrupted" ? "aborted" : "error" },
          error: this.runError,
        });
      }
      void this.syncMessages().catch((error) => this.reportError(error));
      return;
    }

    if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
      if (event.message.role === "assistant") this.lastAssistantId = event.message.id;
      this.scheduleMessageSync();
      return;
    }

    if (event.type === "thread_changed" || event.type === "thread_created" || event.type === "thread_deleted" || event.type === "model_changed") {
      void this.syncThreadState().catch((error) => this.reportError(error));
    }
  }

  private scheduleMessageSync(): void {
    if (this.messageSyncTimer) return;
    this.messageSyncTimer = setTimeout(() => {
      this.messageSyncTimer = undefined;
      void this.syncMessages().catch((error) => this.reportError(error));
    }, 35);
  }

  private async syncMessagesSafely(): Promise<void> {
    try {
      await this.syncMessages();
    } catch (error) {
      this.reportError(error);
    }
  }

  private async syncThreadStateSafely(options: { clearError?: boolean } = {}): Promise<void> {
    try {
      await this.syncThreadState(options);
    } catch (error) {
      this.reportError(error);
    }
  }

  private async resyncAfterPersistence(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 75));
    await this.syncMessagesSafely();
  }

  private async syncMessages(): Promise<void> {
    const session = this.requireSession();
    const rawMessages = (await session.thread.listActiveMessages()) as MastraMessage[];
    const messages: ChatMessage[] = rawMessages
      .map((message) => ({ message, role: chatRole(message) }))
      .filter((entry): entry is { message: MastraMessage; role: ChatMessage["role"] } => entry.role !== null)
      .map(({ message, role }) => ({
        id: message.id,
        role,
        text: extractText(message),
        status: (role === "assistant" && message.id === this.lastAssistantId && this.runOutcome === "streaming"
          ? "streaming"
          : role === "assistant" && message.id === this.lastAssistantId && this.runOutcome === "interrupted"
            ? "interrupted"
            : role === "assistant" && message.id === this.lastAssistantId && this.runOutcome === "error"
              ? "error"
              : "complete") as ChatMessage["status"],
        createdAt: isoDate(message.createdAt),
      }))
      .filter((message) => message.text.length > 0);

    this.publish({ messages });
  }

  private async syncThreadState(options: { clearError?: boolean } = {}): Promise<void> {
    const session = this.requireSession();
    const threads = (await session.thread.list()).map(mapThread).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const activeThreadId = session.thread.getId();
    const selectedModelId = modelFromSession(session.model.get());
    await this.persistActiveThread();
    const nextSnapshot: Partial<RuntimeSnapshot> = {
      threads,
      activeThreadId,
      selectedModelId,
      messages: [],
    };
    if (options.clearError !== false) nextSnapshot.error = null;
    this.publish(nextSnapshot);
    await this.syncMessages();
  }

  private async validateStoredCredential(): Promise<void> {
    const apiKey = await this.vault.get();
    if (!apiKey) {
      this.publish({ status: "needs-key", credential: { configured: false, verified: false } });
      return;
    }

    this.publish({ status: "validating-key", credential: { configured: true, verified: false }, error: null });
    try {
      await validateOpenRouterKey(apiKey);
      this.publish({ credential: { configured: true, verified: true }, status: "loading-models" });
      try {
        const models = await listOpenRouterTextModels(apiKey);
        this.publish({ models, status: "ready", error: null });
        await this.syncThreadState({ clearError: false });
        if (this.snapshot.selectedModelId !== DEFAULT_MODEL_ID && !models.some((model) => model.id === this.snapshot.selectedModelId)) {
          this.publish({
            status: "error",
            error: makeRuntimeError("model-unavailable"),
          });
        }
      } catch {
        this.publish({ status: "ready", error: makeRuntimeError("catalog-unavailable") });
        await this.syncThreadState({ clearError: false });
      }
    } catch (error) {
      const normalized = normalizeError(error);
      const transient = normalized.code === "offline" || normalized.code === "timeout" || normalized.code === "rate-limited";
      this.publish({
        status: transient ? "offline" : normalized.code === "secure-store-unavailable" ? "error" : "needs-key",
        credential: { configured: true, verified: false },
        error: transient || normalized.code === "secure-store-unavailable" ? normalized : makeRuntimeError("invalid-credential"),
      });
    }
  }

  async initialize(): Promise<RuntimeSnapshot> {
    this.initializePromise ??= (async () => {
      try {
        await ensureUserDataDirectory();
        await this.controller.init();
        const persistedThreadId = await this.readPersistedThreadId();
        const activeThreadId = await this.restoreableThreadId(persistedThreadId);
        this.session = await this.controller.createSession({ id: SESSION_ID, ownerId: RESOURCE_ID, resourceId: RESOURCE_ID, threadId: activeThreadId });
        this.subscribeToController();
        await this.syncThreadState();
        await this.validateStoredCredential();
        return this.getSnapshot();
      } catch (error) {
        const normalized = normalizeError(error);
        this.publish({ status: "error", error: normalized });
        return this.getSnapshot();
      }
    })();
    return this.initializePromise;
  }

  async connect(apiKey: string): Promise<void> {
    await this.ensureInitialized();
    const candidate = apiKey.trim();
    if (!candidate) throw new Error("OpenRouter API key cannot be empty");
    if (this.runId) this.abort();
    const previousCredential = this.snapshot.credential;
    this.publish({ status: "validating-key", error: null });
    try {
      await validateOpenRouterKey(candidate);
      await this.vault.set(candidate);
      this.publish({ credential: { configured: true, verified: true }, status: "loading-models", error: null });
      let catalogUnavailable = false;
      try {
        const models = await listOpenRouterTextModels(candidate);
        this.publish({ models, status: "ready", error: null });
      } catch {
        catalogUnavailable = true;
        this.publish({ status: "ready", error: makeRuntimeError("catalog-unavailable") });
      }
      await this.syncThreadState({ clearError: !catalogUnavailable });
    } catch (error) {
      const normalized = normalizeError(error);
      const transient = normalized.code === "offline" || normalized.code === "timeout" || normalized.code === "rate-limited";
      this.publish({
        status: transient ? (previousCredential.verified ? "ready" : "offline") : normalized.code === "secure-store-unavailable" ? "error" : previousCredential.verified ? "ready" : "needs-key",
        credential: previousCredential,
        error: normalized,
      });
      throw normalized;
    }
  }

  async disconnect(): Promise<void> {
    await this.ensureInitialized();
    if (this.runId) this.abort();
    await this.vault.delete();
    this.publish({
      status: "needs-key",
      credential: { configured: false, verified: false },
      error: null,
    });
  }

  async refreshModels(): Promise<void> {
    await this.ensureInitialized();
    const apiKey = await this.vault.get();
    if (!apiKey || !this.snapshot.credential.verified) {
      this.publish({ error: makeRuntimeError("invalid-credential") });
      return;
    }
    this.publish({ status: "loading-models", error: null });
    try {
      const models = await listOpenRouterTextModels(apiKey);
      this.publish({ models, status: "ready", error: null });
      if (this.snapshot.selectedModelId !== DEFAULT_MODEL_ID && !models.some((model) => model.id === this.snapshot.selectedModelId)) {
        this.publish({ status: "error", error: makeRuntimeError("model-unavailable") });
      }
    } catch (error) {
      this.publish({ status: "ready", error: makeRuntimeError("catalog-unavailable") });
      throw error;
    }
  }

  async selectModel(modelId: OpenRouterModelId): Promise<void> {
    const session = await this.ensureInitialized();
    if (!isOpenRouterModelId(modelId)) throw makeRuntimeError("model-unavailable");
    if (this.runId) throw makeRuntimeError("busy");
    if (modelId !== DEFAULT_MODEL_ID && !this.snapshot.models.some((model) => model.id === modelId)) throw makeRuntimeError("model-unavailable");
    await session.model.switch({ modelId, scope: "thread" });
    await this.syncThreadState();
  }

  async createThread(title?: string): Promise<string> {
    const session = await this.ensureInitialized();
    if (this.runId) throw makeRuntimeError("busy");
    const thread = await session.thread.create({ title: title?.trim() || "New chat" });
    await this.syncThreadState();
    return thread.id;
  }

  async switchThread(threadId: string): Promise<void> {
    const session = await this.ensureInitialized();
    if (this.runId) throw makeRuntimeError("busy");
    const thread = await session.thread.getById({ threadId });
    if (!thread) throw new Error("Conversation not found");
    await session.thread.switch({ threadId });
    await this.syncThreadState();
  }

  async renameActiveThread(title: string): Promise<void> {
    const session = await this.ensureInitialized();
    if (this.runId) throw makeRuntimeError("busy");
    const nextTitle = title.trim().slice(0, 80);
    if (!nextTitle) throw new Error("Conversation title cannot be empty");
    await session.thread.rename({ title: nextTitle });
    await this.syncThreadState();
  }

  async deleteThread(threadId: string): Promise<void> {
    const session = await this.ensureInitialized();
    if (this.runId) throw makeRuntimeError("busy");
    await session.thread.delete({ threadId });
    const remaining = (await session.thread.list()).map(mapThread).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    if (!session.thread.getId()) {
      if (remaining[0]) await session.thread.switch({ threadId: remaining[0].id });
      else await session.thread.create({ title: "New chat" });
    }
    await this.syncThreadState();
  }

  send(text: string): { runId: string } {
    const candidate = text.trim();
    if (!candidate) throw new Error("Message cannot be empty");
    if (candidate.length > MAX_INPUT_LENGTH) throw new Error(`Message must be ${MAX_INPUT_LENGTH} characters or fewer`);
    if (this.runId) throw makeRuntimeError("busy");
    if (!this.snapshot.credential.configured || !this.snapshot.credential.verified) throw makeRuntimeError("invalid-credential");
    if (this.snapshot.status === "error" && this.snapshot.error?.code === "model-unavailable") throw makeRuntimeError("model-unavailable");

    const session = this.requireSession();
    const runId = randomUUID();
    this.runId = runId;
    this.lastAssistantId = null;
    this.runOutcome = "streaming";
    this.runError = null;
    this.publish({ status: "running", activeRun: { runId, status: "running" }, error: null });

    void session.sendMessage({ content: candidate })
      .then(async () => {
        if (this.runId !== runId) return;
        if (this.runOutcome === "error" || this.runOutcome === "interrupted") {
          await this.finishFailedRun(runId, this.runError ?? makeRuntimeError(this.runOutcome === "interrupted" ? "aborted" : "unknown"));
          return;
        }
        this.runOutcome = "complete";
        this.runId = null;
        this.runError = null;
        this.publish({ status: "ready", activeRun: null });
        await this.syncMessagesSafely();
        await this.syncThreadStateSafely();
        await this.resyncAfterPersistence();
      })
      .catch(async (error) => {
        if (this.runId !== runId) return;
        await this.finishFailedRun(runId, normalizeError(error));
      });

    return { runId };
  }

  abort(): void {
    if (!this.runId) return;
    this.runOutcome = "interrupted";
    this.runError = makeRuntimeError("aborted");
    this.requireSession().abort();
    this.publish({ activeRun: { runId: this.runId, status: "aborted" }, error: this.runError });
  }

  private async finishFailedRun(runId: string, normalized: RuntimeError): Promise<void> {
    if (this.runId !== runId) return;
    this.runOutcome = normalized.code === "aborted" ? "interrupted" : "error";
    this.runError = normalized;
    this.runId = null;
    this.publish({
      status: normalized.code === "offline" ? "offline" : normalized.code === "secure-store-unavailable" ? "error" : normalized.code === "invalid-credential" ? "needs-key" : "ready",
      activeRun: null,
      error: normalized,
      ...(normalized.code === "invalid-credential" ? { credential: { configured: true, verified: false } } : {}),
    });
    await this.syncMessagesSafely();
    await this.syncThreadStateSafely({ clearError: false });
    await this.resyncAfterPersistence();
    const outcome = normalized.code === "aborted" ? "interrupted" : "error";
    if (this.runId === null && this.runOutcome === outcome && this.runError?.code === normalized.code) {
      this.publish({
        status: normalized.code === "offline" ? "offline" : normalized.code === "secure-store-unavailable" ? "error" : normalized.code === "invalid-credential" ? "needs-key" : "ready",
        activeRun: null,
        error: normalized,
        ...(normalized.code === "invalid-credential" ? { credential: { configured: true, verified: false } } : {}),
      });
    }
  }
}
