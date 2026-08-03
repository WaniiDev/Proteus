import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Agent } from "@mastra/core/agent";
import { AgentController, type AgentControllerDisplayState, type AgentControllerEvent, type AgentControllerThread } from "@mastra/core/agent-controller";
import { ModelsDevGateway, type ProviderConfig } from "@mastra/core/llm";
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { createTool } from "@mastra/core/tools";
import { LocalFilesystem, Workspace } from "@mastra/core/workspace";
import { Utils } from "electrobun/bun";
import { z } from "zod";
import type {
  ChatMessage,
  ChatEvent,
  OpenRouterModelId,
  ProviderErrorCode,
  PendingInteraction,
  QueuedFollowUp,
  RuntimeError,
  RuntimeSnapshot,
  TokenUsage,
  ThreadSummary,
  WorkbenchState,
  WorkbenchTask,
} from "../shared/contracts";
import { createCredentialVault, ensureUserDataDirectory, SecureStoreUnavailableError, type CredentialVault } from "./credentials";
import { getOpenRouterErrorStatus, isOpenRouterModelId, listOpenRouterTextModels, validateOpenRouterKey } from "./openrouter";

const CONTROLLER_ID = "proteus-text-controller";
const AGENT_ID = "proteus-text-agent";
const RESOURCE_ID = "local-user";
const SESSION_ID = "proteus-desktop-session";
const SESSION_STATE_FILE = "proteus-session.json";
const THREAD_METADATA_KEY = "proteus.workbench.v1";
const DEFAULT_MODEL_ID: OpenRouterModelId = "openrouter/auto";
const MAX_INPUT_LENGTH = 32_000;

const OPENROUTER_PROVIDER_CONFIG: ProviderConfig = {
  url: "https://openrouter.ai/api/v1",
  apiKeyEnvVar: "OPENROUTER_API_KEY",
  name: "OpenRouter",
  models: ["auto"],
  gateway: "models.dev",
  npm: "@openrouter/ai-sdk-provider",
};

/** Keep Mastra's model registry scoped to OpenRouter for this product. */
class ProteusOpenRouterGateway extends ModelsDevGateway {
  constructor() {
    super({ openrouter: OPENROUTER_PROVIDER_CONFIG });
  }

  override async fetchProviders(): Promise<Record<string, ProviderConfig>> {
    return { openrouter: OPENROUTER_PROVIDER_CONFIG };
  }
}

const openRouterGateway = new ProteusOpenRouterGateway();

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

type PersistedThreadState = {
  goal?: string;
  tasks?: WorkbenchTask[];
  pendingInteractions?: PendingInteraction[];
  resolvedInteractions?: PendingInteraction[];
  queuedFollowUps?: QueuedFollowUp[];
  clearedFollowUps?: QueuedFollowUp[];
  events?: ChatEvent[];
  tokenUsage?: TokenUsage;
};

type TaskLike = { id?: unknown; content?: unknown; activeForm?: unknown; status?: unknown };

type InteractionResolution = {
  interaction: PendingInteraction;
  status: Extract<PendingInteraction["status"], "approved" | "rejected" | "answered">;
  feedback?: string;
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
    activity: "idle",
    attention: 0,
  };
}

function emptyTokenUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function emptyWorkbench(): WorkbenchState {
  return {
    status: "idle",
    tasks: [],
    pendingInteractions: [],
    queuedFollowUps: [],
    clearedFollowUps: [],
    tokenUsage: emptyTokenUsage(),
    activeTools: [],
  };
}

function taskFromMastra(task: TaskLike): WorkbenchTask | null {
  if (typeof task.id !== "string" || typeof task.content !== "string" || typeof task.activeForm !== "string") return null;
  if (task.status !== "pending" && task.status !== "in_progress" && task.status !== "completed") return null;
  return { id: task.id, content: task.content, activeForm: task.activeForm, status: task.status };
}

function parsePlanText(value: string | undefined): { title: string; summary: string; steps: string[]; raw?: string } {
  const text = value?.trim() ?? "";
  if (!text) return { title: "Plan review", summary: "PROTEUS submitted a plan for review.", steps: [] };
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const title = lines[0]?.replace(/^#+\s*/, "").trim() || "Plan review";
  const steps = lines.filter((line) => /^([-*]|\d+[.)])\s+/.test(line)).map((line) => line.replace(/^([-*]|\d+[.)])\s+/, "").trim());
  const summary = lines.find((line) => !line.startsWith("#") && !/^([-*]|\d+[.)])\s+/.test(line)) ?? title;
  return { title, summary, steps, raw: text };
}

function parseSuspension(event: Extract<AgentControllerEvent, { type: "tool_suspended" }>, previousVersion: number): PendingInteraction | null {
  const payload = event.suspendPayload && typeof event.suspendPayload === "object" ? event.suspendPayload as Record<string, unknown> : {};
  if (event.toolName === "ask_user") {
    const options = Array.isArray(payload.options)
      ? payload.options.map((option) => {
        if (!option || typeof option !== "object" || typeof (option as { label?: unknown }).label !== "string") return null;
        const record = option as { label: string; description?: unknown };
        return {
          label: record.label,
          ...(typeof record.description === "string" ? { description: record.description } : {}),
        };
      }).filter((value): value is { label: string; description?: string } => value !== null)
      : [];
    return {
      id: event.toolCallId,
      toolCallId: event.toolCallId,
      kind: "ask_user",
      title: "PROTEUS has a question",
      question: typeof payload.question === "string" ? payload.question : "What would you like PROTEUS to do next?",
      options,
      selectionMode: payload.selectionMode === "multi_select" ? "multi_select" : options.length > 0 ? "single_select" : undefined,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
  }
  if (event.toolName === "submit_plan") {
    const parsed = parsePlanText(typeof payload.plan === "string" ? payload.plan : undefined);
    return {
      id: event.toolCallId,
      toolCallId: event.toolCallId,
      kind: "submit_plan",
      title: typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : parsed.title,
      options: [],
      plan: { version: previousVersion + 1, ...parsed, status: "draft" },
      status: "pending",
      createdAt: new Date().toISOString(),
    };
  }
  return null;
}

/**
 * The native Mastra submit_plan tool expects the agent to create a file first.
 * PROTEUS intentionally has no workspace writer, so its controller exposes the
 * same suspension contract with an inline plan body instead.
 */
const inlineSubmitPlanTool = createTool({
  id: "submit_plan",
  description: "Submit an inline implementation plan for the user to approve or request changes. Include a short title and the complete plan body.",
  inputSchema: z.object({
    title: z.string().min(1).optional(),
    plan: z.string().min(1),
  }),
  suspendSchema: z.object({
    title: z.string(),
    plan: z.string(),
  }),
  resumeSchema: z.object({
    action: z.enum(["approved", "rejected"]),
    feedback: z.string().optional(),
    title: z.string().optional(),
    plan: z.string().optional(),
  }),
  execute: async ({ title, plan }, context) => {
    try {
      const resumeData = context?.agent?.resumeData;
      if (resumeData !== undefined) {
        const action = resumeData.action === "approved" ? "approved" : "rejected";
        return {
          content: action === "approved"
            ? "The user approved the plan. Continue with the approved work."
            : `The user requested plan changes${resumeData.feedback ? `: ${resumeData.feedback}` : ". Revise and resubmit the plan."}`,
          isError: false,
        };
      }
      const suspend = context?.agent?.suspend;
      if (suspend) {
        await suspend({ title: title?.trim() || "Plan review", plan });
        return;
      }
      return { content: plan, isError: false };
    } catch (error) {
      return { content: `Failed to submit plan: ${error instanceof Error ? error.message : "Unknown error"}`, isError: true };
    }
  },
});

export class TextRuntime {
  private readonly vault: CredentialVault;
  private readonly listeners = new Set<SnapshotListener>();
  private readonly storage: LibSQLStore;
  private readonly memory: Memory;
  private readonly workspace: Workspace;
  private readonly agent: Agent;
  private readonly controller: AgentController;
  private session: Awaited<ReturnType<AgentController["createSession"]>> | undefined;
  private controllerThreadId: string | null = null;
  private selectedThreadId: string | null = null;
  private displayState: AgentControllerDisplayState | null = null;
  private threadState: PersistedThreadState = {};
  private controllerThreadState: PersistedThreadState = {};
  private readonly threadStateCache = new Map<string, PersistedThreadState>();
  private readonly threadWriteQueues = new Map<string, Promise<void>>();
  private readonly threadActivity = new Map<string, { activity: ThreadSummary["activity"]; attention: number }>();
  private readonly resolvingInteractions = new Map<string, InteractionResolution>();
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
    events: [],
    interactions: [],
    resolvedInteractions: [],
    workbench: emptyWorkbench(),
    activeRun: null,
    error: null,
  };
  private runId: string | null = null;
  private runOutcome: "streaming" | "complete" | "interrupted" | "error" = "complete";
  private runError: RuntimeError | null = null;
  private sendGeneration = 0;
  private steerAbortPending = false;
  private lastAssistantId: string | null = null;
  private retryingText: string | null = null;
  private hideSingleRetry = false;
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
      instructions: "You are PROTEUS, a personal AI companion. Respond directly and helpfully in text. You have no external, workspace, or action tools and must never claim to have taken external actions. You may use ask_user when an important user decision is genuinely needed, submit_plan before meaningful multi-step work, and task tools to keep approved work visible. If the user asks for an action you cannot perform, explain that limitation. Use the user’s language when clear; default to English.",
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
      tools: { submit_plan: inlineSubmitPlanTool },
      gateways: [openRouterGateway],
      defaultModeId: "chat",
      modes: [{
        id: "chat",
        name: "Chat",
        defaultModelId: DEFAULT_MODEL_ID,
        availableTools: ["ask_user", "submit_plan", "task_write", "task_update", "task_complete", "task_check"],
      }],
      disableBuiltinTools: ["submit_plan", "subagent"],
    });

    new Mastra({
      storage: this.storage,
      agents: { proteus: this.agent },
      agentControllers: { proteus: this.controller },
      gateways: { "models.dev": openRouterGateway },
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

  private async loadThreadState(threadId: string): Promise<PersistedThreadState> {
    const cached = this.threadStateCache.get(threadId);
    if (cached) return structuredClone(cached);
    try {
      const memoryStore = await this.storage.getStore("memory");
      const thread = await memoryStore?.getThreadById({ threadId, resourceId: RESOURCE_ID });
      const value = thread?.metadata?.[THREAD_METADATA_KEY];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const state = structuredClone(value as PersistedThreadState);
        const pendingInteractions = state.pendingInteractions ?? [];
        const liveInteractions = pendingInteractions.filter((item) => threadId === this.controllerThreadId && this.session?.suspensions.has({ toolCallId: item.toolCallId }));
        const staleInteractions = pendingInteractions.filter((item) => !liveInteractions.includes(item));
        if (staleInteractions.length > 0) {
          state.pendingInteractions = liveInteractions;
          state.resolvedInteractions = [
            ...(state.resolvedInteractions ?? []),
            ...staleInteractions.map((item) => ({ ...item, status: "cancelled" as const })),
          ];
          await this.persistThreadState(threadId, state);
        }
        this.threadStateCache.set(threadId, structuredClone(state));
        return structuredClone(state);
      }
    } catch {
      // Metadata is optional; an empty state is a valid first-run state.
    }
    const empty: PersistedThreadState = {};
    this.threadStateCache.set(threadId, empty);
    return {};
  }

  private async persistThreadState(threadId: string, state = this.threadState): Promise<void> {
    const next = structuredClone(state);
    this.threadStateCache.set(threadId, next);
    const previous = this.threadWriteQueues.get(threadId) ?? Promise.resolve();
    const write = previous.catch(() => undefined).then(async () => {
      try {
        const memoryStore = await this.storage.getStore("memory");
        const thread = await memoryStore?.getThreadById({ threadId, resourceId: RESOURCE_ID });
        if (thread && memoryStore) {
          await memoryStore.updateThread({
            id: threadId,
            title: thread.title ?? "New chat",
            metadata: { ...(thread.metadata ?? {}), [THREAD_METADATA_KEY]: next },
          });
        }
      } catch {
        // Workbench metadata must never make text chat fail.
      }
    });
    let tracked!: Promise<void>;
    tracked = write.finally(() => {
      if (this.threadWriteQueues.get(threadId) === tracked) this.threadWriteQueues.delete(threadId);
    });
    this.threadWriteQueues.set(threadId, tracked);
    await tracked;
  }

  private displayStateForThread(threadId: string): AgentControllerDisplayState | null {
    return threadId === this.controllerThreadId ? this.displayState : null;
  }

  private workbenchFromState(state: PersistedThreadState, displayState: AgentControllerDisplayState | null, runStatus: RuntimeSnapshot["activeRun"] = this.snapshot.activeRun): WorkbenchState {
    const projectedTasks = displayState?.tasks?.map(taskFromMastra).filter((task): task is WorkbenchTask => task !== null) ?? [];
    const tasks = projectedTasks.length > 0 ? projectedTasks : state.tasks ?? [];
    const pendingInteractions = state.pendingInteractions ?? [];
    const activeTools = displayState ? Array.from(displayState.activeTools.entries()).map(([id, tool]) => ({ id, name: tool.name, status: tool.status })) : [];
    const pending = pendingInteractions.length > 0;
    const status: WorkbenchState["status"] = pending ? "waiting" : runStatus?.threadId === this.selectedThreadId && runStatus.status === "running" ? "active" : runStatus?.threadId === this.selectedThreadId && runStatus.status === "aborted" ? "interrupted" : this.snapshot.error && runStatus?.threadId === this.selectedThreadId ? "error" : tasks.some((task) => task.status !== "completed") ? "active" : tasks.length > 0 ? "complete" : "idle";
    const usage = displayState?.tokenUsage ?? state.tokenUsage ?? emptyTokenUsage();
    return {
      status,
      goal: state.goal,
      tasks,
      pendingInteractions,
      queuedFollowUps: state.queuedFollowUps ?? [],
      clearedFollowUps: state.clearedFollowUps ?? [],
      tokenUsage: {
        promptTokens: usage.promptTokens ?? 0,
        completionTokens: usage.completionTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
        ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
      },
      activeTools,
    };
  }

  private async publishSelectedThread(threadId: string, options: { clearError?: boolean } = {}): Promise<void> {
    const session = this.requireSession();
    const [rawMessages, state] = await Promise.all([
      session.thread.listMessages({ threadId }),
      this.loadThreadState(threadId),
    ]);
    this.selectedThreadId = threadId;
    this.threadState = state;
    const messages = this.mapMessages(rawMessages);
    const displayState = this.displayStateForThread(threadId);
    const workbench = this.workbenchFromState(state, displayState);
    const next: Partial<RuntimeSnapshot> = {
      activeThreadId: threadId,
      messages,
      events: state.events ?? [],
      interactions: state.pendingInteractions ?? [],
      resolvedInteractions: state.resolvedInteractions ?? [],
      workbench,
    };
    if (options.clearError !== false) next.error = null;
    this.publish(next);
  }

  private updateThreadActivity(threadId: string, activity: ThreadSummary["activity"], attention?: number): void {
    const current = this.threadActivity.get(threadId);
    this.threadActivity.set(threadId, { activity, attention: attention ?? current?.attention ?? 0 });
    this.publish({
      threads: this.snapshot.threads.map((thread) => thread.id === threadId
        ? { ...thread, activity, attention: attention ?? thread.attention }
        : thread),
    });
  }

  private mapMessages(rawMessages: MastraMessage[]): ChatMessage[] {
    const retryMatches = this.retryingText
      ? rawMessages.map((message, index) => chatRole(message) === "user" && extractText(message) === this.retryingText ? index : -1).filter((index) => index >= 0)
      : [];
    const hiddenRetryIndex = retryMatches.length >= 2 || (this.hideSingleRetry && retryMatches.length >= 1) ? retryMatches[retryMatches.length - 1] : -1;
    return rawMessages
      .map((message) => ({ message, role: chatRole(message) }))
      .filter((entry, index): entry is { message: MastraMessage; role: ChatMessage["role"] } => entry.role !== null && index !== hiddenRetryIndex)
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
        retryable: role === "assistant" && message.id === this.lastAssistantId ? this.runError?.retryable : undefined,
      }))
      .filter((message) => message.text.length > 0);
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
    if (event.type === "display_state_changed") {
      this.displayState = event.displayState;
      const threadId = this.controllerThreadId;
      if (threadId) {
        const tasks = event.displayState.tasks.map(taskFromMastra).filter((task): task is WorkbenchTask => task !== null);
        this.controllerThreadState = { ...this.controllerThreadState, tasks, tokenUsage: event.displayState.tokenUsage };
        void this.persistThreadState(threadId, this.controllerThreadState);
        if (this.selectedThreadId === threadId) {
          this.threadState = this.controllerThreadState;
          const workbench = this.workbenchFromState(this.threadState, event.displayState);
          this.publish({
            interactions: this.controllerThreadState.pendingInteractions ?? [],
            resolvedInteractions: this.controllerThreadState.resolvedInteractions ?? [],
            events: this.controllerThreadState.events ?? [],
            workbench,
          });
        }
      }
      return;
    }

    if (event.type === "tool_suspended") {
      const previousVersion = this.nextPlanVersion() - 1;
      const interaction = parseSuspension(event, previousVersion);
      if (interaction) {
        this.controllerThreadState = {
          ...this.controllerThreadState,
          pendingInteractions: [...(this.controllerThreadState.pendingInteractions ?? []), interaction],
        };
        if (this.controllerThreadId) void this.persistThreadState(this.controllerThreadId, this.controllerThreadState);
        this.runOutcome = "streaming";
        if (this.runId) {
          this.publish({
            status: "running",
            activeRun: { runId: this.runId, threadId: this.controllerThreadId ?? this.selectedThreadId ?? "unknown", status: "running" },
          });
          this.updateThreadActivity(this.controllerThreadId ?? this.selectedThreadId ?? "", "waiting", 1);
        }
        if (this.selectedThreadId === this.controllerThreadId) {
          this.threadState = this.controllerThreadState;
          this.publish({
            interactions: this.controllerThreadState.pendingInteractions ?? [],
            workbench: this.workbenchFromState(this.controllerThreadState, this.displayState),
          });
        }
      }
      return;
    }

    if (event.type === "tool_suspension_cancelled") {
      this.finalizeResolvingInteractions(event.toolCallId, "cancelled", event.reason || "Mastra cancelled the resume.");
      const cancelled = this.controllerThreadState.pendingInteractions?.find((item) => item.toolCallId === event.toolCallId);
      if (cancelled) {
        this.controllerThreadState = {
          ...this.controllerThreadState,
          pendingInteractions: (this.controllerThreadState.pendingInteractions ?? []).filter((item) => item.toolCallId !== event.toolCallId),
          resolvedInteractions: [...(this.controllerThreadState.resolvedInteractions ?? []), { ...cancelled, status: "cancelled" }],
        };
        if (this.controllerThreadId) void this.persistThreadState(this.controllerThreadId, this.controllerThreadState);
        if (this.selectedThreadId === this.controllerThreadId) this.publish({ interactions: this.controllerThreadState.pendingInteractions ?? [], resolvedInteractions: this.controllerThreadState.resolvedInteractions ?? [], workbench: this.workbenchFromState(this.controllerThreadState, this.displayState) });
      }
      return;
    }

    if (event.type === "tool_end" && this.resolvingInteractions.has(event.toolCallId)) {
      this.finalizeResolvingInteractions(
        event.toolCallId,
        event.isError ? "cancelled" : undefined,
        event.isError ? "Mastra resumed the request but the tool returned an error." : undefined,
      );
      return;
    }

    if (event.type === "agent_start") {
      // Mastra emits an aborted terminal event for the stream that steer()
      // replaces. The replacement agent_start marks the handoff complete.
      if (this.steerAbortPending) this.steerAbortPending = false;
      this.runOutcome = "streaming";
      this.runError = null;
      this.publish({ status: "running" });
      if (this.controllerThreadId) this.updateThreadActivity(this.controllerThreadId, "running");
      return;
    }

    if (event.type === "error") {
      const normalized = normalizeError(event.error);
      this.finalizeResolvingInteractions(undefined, "cancelled", `Resume failed: ${normalized.message}`);
      this.runOutcome = normalized.code === "aborted" ? "interrupted" : "error";
      this.runError = normalized;
      if (this.runId) {
        this.publish({
          activeRun: { runId: this.runId, threadId: this.controllerThreadId ?? this.selectedThreadId ?? "unknown", status: this.runOutcome === "interrupted" ? "aborted" : "error" },
          error: normalized,
        });
      }
      return;
    }

    if (event.type === "agent_end") {
      if (event.reason === "aborted" && this.steerAbortPending) {
        this.steerAbortPending = false;
        return;
      }
      if (event.reason === "suspended") {
        if (this.controllerThreadId) this.updateThreadActivity(this.controllerThreadId, "waiting", 1);
        return;
      }
      if (this.runOutcome !== "error" && this.runOutcome !== "interrupted") {
        this.runOutcome = event.reason === "aborted" ? "interrupted" : event.reason === "error" ? "error" : "complete";
      }
      if (this.runOutcome === "interrupted" && !this.runError) this.runError = makeRuntimeError("aborted");
      if (this.runOutcome === "error" && !this.runError) this.runError = makeRuntimeError("unknown");
      const endedRunId = this.runId;
      const endedThreadId = this.controllerThreadId;
      if (endedRunId && this.runError) {
        this.publish({
          activeRun: { runId: endedRunId, threadId: endedThreadId ?? this.selectedThreadId ?? "unknown", status: this.runOutcome === "interrupted" ? "aborted" : "error" },
          error: this.runError,
        });
      }
      if (endedRunId && endedThreadId && this.runOutcome === "complete") {
        this.runId = null;
        this.runError = null;
        this.publish({ status: "ready", activeRun: null, error: null });
        this.updateThreadActivity(endedThreadId, "complete", 0);
        void this.syncMessagesSafely(endedThreadId).then(async () => {
          await this.refreshThreadSummaries();
          if (this.selectedThreadId === endedThreadId) await this.publishSelectedThread(endedThreadId, { clearError: false });
          await this.drainQueuedFollowUp(endedThreadId);
        });
      } else {
        void this.syncMessages().catch((error) => this.reportError(error));
        if (this.controllerThreadId) this.updateThreadActivity(this.controllerThreadId, this.runOutcome === "interrupted" ? "interrupted" : this.runOutcome === "error" ? "error" : "complete");
        if (endedRunId && this.runError && this.runOutcome !== "complete") void this.finishFailedRun(endedRunId, this.runError);
      }
      return;
    }

    if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
      if (event.message.role === "assistant") this.lastAssistantId = event.message.id;
      this.scheduleMessageSync();
      return;
    }

    if (event.type === "usage_update") {
      if (this.controllerThreadId) {
        this.controllerThreadState = { ...this.controllerThreadState, tokenUsage: event.usage };
        void this.persistThreadState(this.controllerThreadId, this.controllerThreadState);
      }
      return;
    }

    if (event.type === "follow_up_queued") {
      if (this.selectedThreadId === this.controllerThreadId) {
        if (this.selectedThreadId === this.controllerThreadId) this.publish({ workbench: this.workbenchFromState(this.controllerThreadState, this.displayState) });
      }
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

  private async syncMessagesSafely(threadId?: string): Promise<void> {
    try {
      await this.syncMessages(threadId);
    } catch (error) {
      this.reportError(error);
    }
  }

  private async refreshThreadSummaries(): Promise<void> {
    const threads = (await this.requireSession().thread.list()).map((thread) => {
      const summary = mapThread(thread);
      const activity = this.threadActivity.get(summary.id);
      return activity ? { ...summary, ...activity } : summary;
    }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    this.publish({ threads });
  }

  private async syncMessages(threadId = this.selectedThreadId ?? this.controllerThreadId ?? undefined): Promise<void> {
    if (!threadId) {
      this.publish({ messages: [] });
      return;
    }
    const rawMessages = (await this.requireSession().thread.listMessages({ threadId })) as MastraMessage[];
    const messages = this.mapMessages(rawMessages);
    if (threadId === this.selectedThreadId) this.publish({ messages });
  }

  private async syncThreadState(options: { clearError?: boolean } = {}): Promise<void> {
    const session = this.requireSession();
    const threads = (await session.thread.list()).map((thread) => {
      const summary = mapThread(thread);
      const activity = this.threadActivity.get(summary.id);
      return activity ? { ...summary, ...activity } : summary;
    }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const activeThreadId = session.thread.getId();
    if (activeThreadId !== this.controllerThreadId) this.displayState = null;
    const selectedModelId = modelFromSession(session.model.get());
    this.controllerThreadId = activeThreadId;
    this.selectedThreadId = activeThreadId;
    this.threadState = activeThreadId ? await this.loadThreadState(activeThreadId) : {};
    this.controllerThreadState = this.threadState;
    await this.persistActiveThread();
    const nextSnapshot: Partial<RuntimeSnapshot> = {
      threads,
      activeThreadId,
      selectedModelId,
      messages: [],
      events: this.threadState.events ?? [],
      interactions: this.threadState.pendingInteractions ?? [],
      resolvedInteractions: this.threadState.resolvedInteractions ?? [],
      workbench: this.workbenchFromState(this.threadState, this.displayState),
    };
    if (options.clearError !== false) nextSnapshot.error = null;
    this.publish(nextSnapshot);
    await this.syncMessages(activeThreadId ?? undefined);
  }

  private nextPlanVersion(): number {
    const versions = [
      ...(this.controllerThreadState.pendingInteractions ?? []),
      ...(this.controllerThreadState.resolvedInteractions ?? []),
    ].map((item) => item.plan?.version ?? 0);
    return Math.max(0, ...versions) + 1;
  }

  private resolvedInteraction(entry: InteractionResolution, terminalStatus: PendingInteraction["status"] = entry.status, feedback?: string): PendingInteraction {
    const plan = entry.interaction.plan;
    const planStatus = terminalStatus === "approved" ? "approved" : terminalStatus === "rejected" ? "rejected" : terminalStatus === "cancelled" ? "draft" : entry.status === "approved" ? "approved" : entry.status === "rejected" ? "rejected" : plan?.status;
    return {
      ...entry.interaction,
      status: terminalStatus,
      ...(plan ? {
        plan: {
          ...plan,
          ...(planStatus ? { status: planStatus } : {}),
          ...(feedback || entry.feedback ? { feedback: feedback || entry.feedback } : {}),
        },
      } : {}),
    };
  }

  private finalizeResolvingInteractions(toolCallId?: string, terminalStatus?: PendingInteraction["status"], feedback?: string): void {
    const entries = [...this.resolvingInteractions.entries()].filter(([id]) => !toolCallId || id === toolCallId);
    if (entries.length === 0) return;
    const resolved = entries.map(([, entry]) => this.resolvedInteraction(entry, terminalStatus ?? entry.status, feedback));
    const resolvedIds = new Set(entries.map(([id]) => id));
    for (const id of resolvedIds) this.resolvingInteractions.delete(id);
    this.controllerThreadState = {
      ...this.controllerThreadState,
      pendingInteractions: (this.controllerThreadState.pendingInteractions ?? []).filter((item) => !resolvedIds.has(item.toolCallId)),
      resolvedInteractions: [...(this.controllerThreadState.resolvedInteractions ?? []), ...resolved],
    };
    const threadId = this.controllerThreadId ?? this.selectedThreadId;
    if (threadId) void this.persistThreadState(threadId, this.controllerThreadState);
    if (this.selectedThreadId === this.controllerThreadId) {
      this.threadState = this.controllerThreadState;
      this.publish({
        interactions: this.controllerThreadState.pendingInteractions ?? [],
        resolvedInteractions: this.controllerThreadState.resolvedInteractions ?? [],
        workbench: this.workbenchFromState(this.controllerThreadState, this.displayState),
      });
    }
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

  async selectThread(threadId: string): Promise<void> {
    const session = await this.ensureInitialized();
    const thread = await session.thread.getById({ threadId });
    if (!thread) throw new Error("Conversation not found");

    if (this.runId && threadId !== this.controllerThreadId) {
      await this.publishSelectedThread(threadId);
      this.updateThreadActivity(this.controllerThreadId ?? "", "running", 0);
      return;
    }

    if (threadId === this.controllerThreadId) {
      await this.publishSelectedThread(threadId);
      return;
    }

    await session.thread.switch({ threadId });
    await this.syncThreadState();
  }

  async switchThread(threadId: string): Promise<void> {
    await this.selectThread(threadId);
  }

  async renameThread(threadId: string, title: string): Promise<void> {
    const session = await this.ensureInitialized();
    if (this.runId) throw makeRuntimeError("busy");
    const nextTitle = title.trim().slice(0, 80);
    if (!nextTitle) throw new Error("Conversation title cannot be empty");
    const thread = await session.thread.getById({ threadId });
    if (!thread) throw new Error("Conversation not found");
    const currentThreadId = session.thread.getId();
    if (currentThreadId !== threadId) await session.thread.switch({ threadId });
    try {
      await session.thread.rename({ title: nextTitle });
    } finally {
      if (currentThreadId && currentThreadId !== threadId) await session.thread.switch({ threadId: currentThreadId });
    }
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

  async send(text: string): Promise<{ runId: string }> {
    await this.ensureInitialized();
    const candidate = text.trim();
    if (!candidate) throw new Error("Message cannot be empty");
    if (candidate.length > MAX_INPUT_LENGTH) throw new Error(`Message must be ${MAX_INPUT_LENGTH} characters or fewer`);
    if (!this.snapshot.credential.configured || !this.snapshot.credential.verified) throw makeRuntimeError("invalid-credential");
    if (this.snapshot.status === "error" && this.snapshot.error?.code === "model-unavailable") throw makeRuntimeError("model-unavailable");
    this.retryingText = null;
    this.hideSingleRetry = false;

    const session = this.requireSession();
    if (this.runId) {
      if (this.selectedThreadId !== this.controllerThreadId) throw makeRuntimeError("busy");
      const queued: QueuedFollowUp = { id: randomUUID(), content: candidate, createdAt: new Date().toISOString() };
      this.controllerThreadState = { ...this.controllerThreadState, queuedFollowUps: [...(this.controllerThreadState.queuedFollowUps ?? []), queued] };
      if (this.controllerThreadId) await this.persistThreadState(this.controllerThreadId, this.controllerThreadState);
      this.threadState = this.controllerThreadState;
      this.publish({ workbench: this.workbenchFromState(this.controllerThreadState, this.displayState) });
      return { runId: this.runId };
    }

    if (this.selectedThreadId && this.selectedThreadId !== this.controllerThreadId) {
      await session.thread.switch({ threadId: this.selectedThreadId });
      await this.syncThreadState();
    }
    const activeThreadId = session.thread.getId();
    if (activeThreadId) {
      const activeThread = await session.thread.getById({ threadId: activeThreadId });
      if (activeThread?.title?.trim().toLowerCase() === "new chat") {
        const title = candidate.replace(/\s+/g, " ").slice(0, 56).trim() || "New chat";
        await session.thread.rename({ title });
      }
    }
    return this.startRun(candidate);
  }

  private startRun(candidate: string): { runId: string } {
    const session = this.requireSession();
    const threadId = this.controllerThreadId ?? session.thread.getId();
    if (!threadId) throw new Error("No active conversation");
    const runId = randomUUID();
    const sendGeneration = ++this.sendGeneration;
    this.runId = runId;
    this.lastAssistantId = null;
    this.runOutcome = "streaming";
    this.runError = null;
    this.publish({ status: "running", activeRun: { runId, threadId, status: "running" }, error: null });
    this.updateThreadActivity(threadId, "running");

    void session.sendMessage({ content: candidate })
      .then(async () => {
        if (this.runId !== runId || this.sendGeneration !== sendGeneration) return;
        if ((this.controllerThreadState.pendingInteractions?.length ?? 0) > 0 || session.suspensions.hasPending()) {
          this.updateThreadActivity(threadId, "waiting", 1);
          return;
        }
        if (this.runOutcome === "error" || this.runOutcome === "interrupted") {
          await this.finishFailedRun(runId, this.runError ?? makeRuntimeError(this.runOutcome === "interrupted" ? "aborted" : "unknown"));
          return;
        }
        this.runOutcome = "complete";
        this.runId = null;
        this.runError = null;
        this.publish({ status: "ready", activeRun: null });
        this.updateThreadActivity(threadId, "complete");
        await this.syncMessagesSafely(threadId);
        await this.refreshThreadSummaries();
        if (this.selectedThreadId === threadId) await this.publishSelectedThread(threadId, { clearError: false });
        await this.drainQueuedFollowUp(threadId);
      })
      .catch(async (error) => {
        if (this.runId !== runId || this.sendGeneration !== sendGeneration) return;
        await this.finishFailedRun(runId, normalizeError(error));
      });

    return { runId };
  }

  private async drainQueuedFollowUp(threadId: string): Promise<void> {
    if (this.runId || threadId !== this.controllerThreadId) return;
    const next = this.controllerThreadState.queuedFollowUps?.[0];
    if (!next) return;
    this.startRun(next.content);
    this.controllerThreadState = {
      ...this.controllerThreadState,
      queuedFollowUps: (this.controllerThreadState.queuedFollowUps ?? []).slice(1),
    };
    await this.persistThreadState(threadId, this.controllerThreadState);
    if (this.selectedThreadId === threadId) this.threadState = this.controllerThreadState;
    if (this.selectedThreadId === threadId) this.publish({ workbench: this.workbenchFromState(this.controllerThreadState, this.displayState) });
  }

  async steer(text: string): Promise<{ runId: string }> {
    await this.ensureInitialized();
    const candidate = text.trim();
    if (!candidate) throw new Error("Steering message cannot be empty");
    if (!this.runId || this.selectedThreadId !== this.controllerThreadId) throw makeRuntimeError("busy");
    const threadId = this.controllerThreadId;
    if (!threadId) throw new Error("No active conversation");
    const runId = this.runId;
    const cleared = this.controllerThreadState.queuedFollowUps ?? [];
    const pendingInteractions = this.controllerThreadState.pendingInteractions ?? [];
    this.resolvingInteractions.clear();
    this.controllerThreadState = {
      ...this.controllerThreadState,
      queuedFollowUps: [],
      clearedFollowUps: [...(this.controllerThreadState.clearedFollowUps ?? []), ...cleared],
      pendingInteractions: [],
      resolvedInteractions: [
        ...(this.controllerThreadState.resolvedInteractions ?? []),
        ...pendingInteractions.map((item) => ({ ...item, status: "cancelled" as const })),
      ],
      events: [...(this.controllerThreadState.events ?? []), { id: randomUUID(), type: "steer", text: `You redirected PROTEUS: ${candidate}`, createdAt: new Date().toISOString() }],
    };
    await this.persistThreadState(threadId, this.controllerThreadState);
    this.threadState = this.controllerThreadState;
    this.runOutcome = "streaming";
    this.runError = null;
    this.sendGeneration += 1;
    this.steerAbortPending = true;
    this.publish({
      status: "running",
      error: null,
      events: this.controllerThreadState.events ?? [],
      interactions: [],
      resolvedInteractions: this.controllerThreadState.resolvedInteractions ?? [],
      workbench: this.workbenchFromState(this.controllerThreadState, this.displayState),
    });
    try {
      void this.requireSession().steer({ content: candidate }).catch(async (error) => {
        this.steerAbortPending = false;
        if (this.runId === runId) await this.finishFailedRun(runId, normalizeError(error));
      });
    } catch (error) {
      this.steerAbortPending = false;
      await this.finishFailedRun(runId, normalizeError(error));
      throw error;
    }
    return { runId };
  }

  async respondToInteraction(toolCallId: string, response: unknown): Promise<void> {
    const session = await this.ensureInitialized();
    const interaction = this.controllerThreadState.pendingInteractions?.find((item) => item.toolCallId === toolCallId);
    if (!interaction) throw new Error("That request is no longer waiting for an answer");
    if (interaction.status !== "pending") throw new Error("That request is already being resolved");
    if (!session.suspensions.has({ toolCallId })) throw new Error("That request is no longer available after the current run ended");
    let resumeData: unknown;
    let nextStatus: Extract<PendingInteraction["status"], "approved" | "rejected" | "answered">;
    let feedback: string | undefined;
    if (interaction.kind === "submit_plan") {
      if (!response || typeof response !== "object") throw new Error("Plan approval response is invalid");
      const record = response as { action?: unknown; feedback?: unknown };
      if (record.action !== "approved" && record.action !== "rejected") throw new Error("Choose approve or request changes");
      feedback = typeof record.feedback === "string" && record.feedback.trim() ? record.feedback.trim() : undefined;
      resumeData = {
        action: record.action,
        ...(feedback ? { feedback } : {}),
      };
      nextStatus = record.action === "approved" ? "approved" : "rejected";
    } else {
      const options = interaction.options.map((option) => option.label);
      if (interaction.options.length > 0 && interaction.selectionMode === "multi_select") {
        if (!Array.isArray(response) || response.length === 0 || response.some((value) => typeof value !== "string" || !options.includes(value))) throw new Error("Choose one or more of the available options");
        resumeData = response;
      } else if (interaction.options.length > 0) {
        if (typeof response !== "string" || !options.includes(response)) throw new Error("Choose one of the available options");
        resumeData = response;
      } else {
        if (typeof response !== "string" || !response.trim()) throw new Error("Answer cannot be empty");
        resumeData = response.trim();
      }
      nextStatus = "answered";
    }
    const resolving = { ...interaction, status: "resolving" as const };
    this.resolvingInteractions.set(toolCallId, { interaction, status: nextStatus, feedback });
    this.controllerThreadState = {
      ...this.controllerThreadState,
      pendingInteractions: (this.controllerThreadState.pendingInteractions ?? []).map((item) => item.toolCallId === toolCallId ? resolving : item),
    };
    await this.persistThreadState(this.controllerThreadId ?? this.selectedThreadId ?? "", this.controllerThreadState);
    if (this.selectedThreadId === this.controllerThreadId) {
      this.threadState = this.controllerThreadState;
      this.publish({
        interactions: this.controllerThreadState.pendingInteractions ?? [],
        workbench: this.workbenchFromState(this.controllerThreadState, this.displayState),
      });
    }
    try {
      await session.respondToToolSuspension({ toolCallId, resumeData });
    } catch (error) {
      this.finalizeResolvingInteractions(toolCallId, "cancelled", `Resume failed: ${error instanceof Error ? error.message : "Mastra could not resume this request."}`);
      throw error;
    }
  }

  async updateQueuedFollowUp(id: string, content: string): Promise<void> {
    await this.ensureInitialized();
    const nextContent = content.trim();
    if (!nextContent) throw new Error("Queued message cannot be empty");
    const queue = this.controllerThreadState.queuedFollowUps ?? [];
    if (!queue.some((item) => item.id === id)) throw new Error("Queued message not found");
    this.controllerThreadState = { ...this.controllerThreadState, queuedFollowUps: queue.map((item) => item.id === id ? { ...item, content: nextContent } : item) };
    await this.persistThreadState(this.controllerThreadId ?? this.selectedThreadId ?? "", this.controllerThreadState);
    if (this.selectedThreadId === this.controllerThreadId) this.publish({ workbench: this.workbenchFromState(this.controllerThreadState, this.displayState) });
  }

  async removeQueuedFollowUp(id: string): Promise<void> {
    await this.ensureInitialized();
    const queue = this.controllerThreadState.queuedFollowUps ?? [];
    if (!queue.some((item) => item.id === id)) throw new Error("Queued message not found");
    this.controllerThreadState = { ...this.controllerThreadState, queuedFollowUps: queue.filter((item) => item.id !== id) };
    await this.persistThreadState(this.controllerThreadId ?? this.selectedThreadId ?? "", this.controllerThreadState);
    if (this.selectedThreadId === this.controllerThreadId) this.publish({ workbench: this.workbenchFromState(this.controllerThreadState, this.displayState) });
  }

  async restoreQueuedFollowUp(id: string): Promise<void> {
    await this.ensureInitialized();
    const cleared = this.controllerThreadState.clearedFollowUps ?? [];
    const item = cleared.find((entry) => entry.id === id);
    if (!item) throw new Error("Cleared message not found");
    this.controllerThreadState = {
      ...this.controllerThreadState,
      clearedFollowUps: cleared.filter((entry) => entry.id !== id),
      queuedFollowUps: [...(this.controllerThreadState.queuedFollowUps ?? []), item],
    };
    await this.persistThreadState(this.controllerThreadId ?? this.selectedThreadId ?? "", this.controllerThreadState);
    if (this.selectedThreadId === this.controllerThreadId) this.publish({ workbench: this.workbenchFromState(this.controllerThreadState, this.displayState) });
  }

  async retry(messageId: string): Promise<{ runId: string }> {
    await this.ensureInitialized();
    if (this.runId) throw makeRuntimeError("busy");
    const session = this.requireSession();
    const sourceThreadId = this.selectedThreadId ?? this.controllerThreadId ?? "";
    const messages = (await session.thread.listMessages({ threadId: sourceThreadId })) as MastraMessage[];
    const index = messages.findIndex((message) => message.id === messageId);
    let sourceIndex = -1;
    if (index >= 0) {
      for (let candidate = index; candidate >= 0; candidate -= 1) {
        if (messages[candidate].role === "user") {
          sourceIndex = candidate;
          break;
        }
      }
    }
    const source = sourceIndex >= 0 ? messages[sourceIndex] : undefined;
    const content = source ? extractText(source) : undefined;
    if (!source || !content) throw new Error("The original user message could not be recovered");
    const originalThread = await session.thread.getById({ threadId: sourceThreadId });
    const sourceState = await this.loadThreadState(sourceThreadId);
    const retryThread = await session.thread.clone({
      sourceThreadId,
      title: `${originalThread?.title?.trim() || "Conversation"} · retry`,
      resourceId: RESOURCE_ID,
    });
    const staleInteractions = sourceState.pendingInteractions ?? [];
    const retryState: PersistedThreadState = {
      ...sourceState,
      pendingInteractions: [],
      resolvedInteractions: [
        ...(sourceState.resolvedInteractions ?? []),
        ...staleInteractions.map((item) => ({ ...item, status: "cancelled" as const })),
      ],
    };
    await this.persistThreadState(retryThread.id, retryState);
    const retryMessages = (await session.thread.listMessages({ threadId: retryThread.id })) as MastraMessage[];
    const sourceUserOrdinal = messages.slice(0, sourceIndex + 1).filter((message) => message.role === "user" && extractText(message) === content).length - 1;
    let retrySourceIndex = -1;
    let seenMatchingUser = 0;
    for (let candidate = 0; candidate < retryMessages.length; candidate += 1) {
      if (retryMessages[candidate].role === "user" && extractText(retryMessages[candidate]) === content) {
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
    await this.syncThreadState();
    this.retryingText = null;
    this.hideSingleRetry = false;
    return this.startRun(content);
  }

  async continueFrom(messageId: string): Promise<{ runId: string }> {
    await this.ensureInitialized();
    if (this.runId) throw makeRuntimeError("busy");
    const message = this.snapshot.messages.find((item) => item.id === messageId);
    if (!message) throw new Error("Stopped response not found");
    const continuation = "Continue from the stopped response without repeating what is already visible. Finish the answer naturally.";
    this.retryingText = continuation;
    this.hideSingleRetry = true;
    return this.startRun(continuation);
  }

  abort(): void {
    if (!this.runId) return;
    this.runOutcome = "interrupted";
    this.runError = makeRuntimeError("aborted");
    const pendingInteractions = this.controllerThreadState.pendingInteractions ?? [];
    if (pendingInteractions.length > 0) {
      this.resolvingInteractions.clear();
      this.controllerThreadState = {
        ...this.controllerThreadState,
        pendingInteractions: [],
        resolvedInteractions: [
          ...(this.controllerThreadState.resolvedInteractions ?? []),
          ...pendingInteractions.map((item) => ({ ...item, status: "cancelled" as const })),
        ],
      };
      const threadId = this.controllerThreadId ?? this.selectedThreadId;
      if (threadId) void this.persistThreadState(threadId, this.controllerThreadState);
      if (this.selectedThreadId === this.controllerThreadId) this.publish({ interactions: [], resolvedInteractions: this.controllerThreadState.resolvedInteractions ?? [], workbench: this.workbenchFromState(this.controllerThreadState, this.displayState) });
    }
    this.requireSession().abort();
    this.publish({ activeRun: { runId: this.runId, threadId: this.controllerThreadId ?? this.selectedThreadId ?? "unknown", status: "aborted" }, error: this.runError });
  }

  private async finishFailedRun(runId: string, normalized: RuntimeError): Promise<void> {
    if (this.runId !== runId) return;
    this.runOutcome = normalized.code === "aborted" ? "interrupted" : "error";
    this.runError = normalized;
    this.runId = null;
    const failedThreadId = this.controllerThreadId ?? this.selectedThreadId ?? "unknown";
    this.publish({
      status: normalized.code === "offline" ? "offline" : normalized.code === "secure-store-unavailable" ? "error" : normalized.code === "invalid-credential" ? "needs-key" : "ready",
      activeRun: null,
      error: normalized,
      ...(normalized.code === "invalid-credential" ? { credential: { configured: true, verified: false } } : {}),
    });
    this.updateThreadActivity(failedThreadId, normalized.code === "aborted" ? "interrupted" : "error");
    await this.syncMessagesSafely(failedThreadId);
    await this.refreshThreadSummaries();
    if (this.selectedThreadId === failedThreadId) await this.publishSelectedThread(failedThreadId, { clearError: false });
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
