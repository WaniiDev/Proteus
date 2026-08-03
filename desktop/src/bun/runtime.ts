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
  ToolApproval,
  TokenUsage,
  ThreadSummary,
  WorkbenchState,
  WorkbenchTask,
} from "../shared/contracts";
import { createCredentialVault, ensureUserDataDirectory, SecureStoreUnavailableError, type CredentialVault } from "./credentials";
import { getOpenRouterErrorStatus, isOpenRouterModelId, listOpenRouterTextModels, validateOpenRouterKey } from "./openrouter";
import {
  projectPendingInteractions,
  projectTasks,
  upsertChatMessage,
  parseSuspendedInteraction,
  reconcileLiveAssistantTurn,
  type LiveAssistantProjection,
} from "./runtime-projection";

const CONTROLLER_ID = "proteus-text-controller";
const AGENT_ID = "proteus-text-agent";
const RESOURCE_ID = "local-user";
const SESSION_ID = "proteus-desktop-session";
const SESSION_STATE_FILE = "proteus-session.json";
const THREAD_METADATA_KEY = "proteus.workbench.v1";
const DEFAULT_MODEL_ID: OpenRouterModelId = "openrouter/auto";
const MAX_INPUT_LENGTH = 32_000;
const INTERNAL_TOOL_GRANTS = ["ask_user", "submit_plan", "task_write", "task_update", "task_complete", "task_check"] as const;

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

function pendingApprovalToolName(message: MastraMessage): string | null {
  if (message.role !== "assistant" || !message.content || typeof message.content !== "object" || Array.isArray(message.content)) return null;
  const metadata = (message.content as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const pending = (metadata as { pendingToolApprovals?: unknown }).pendingToolApprovals;
  if (Array.isArray(pending)) {
    const item = pending.find((value) => value && typeof value === "object" && typeof (value as { toolName?: unknown }).toolName === "string");
    return item ? (item as { toolName: string }).toolName : null;
  }
  if (pending && typeof pending === "object") {
    const values = Object.values(pending as Record<string, unknown>);
    const item = values.find((value) => value && typeof value === "object" && typeof (value as { toolName?: unknown }).toolName === "string");
    return item ? (item as { toolName: string }).toolName : null;
  }
  return null;
}

function sanitizeApprovalArgs(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[truncated]";
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeApprovalArgs(item, depth + 1));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(record).slice(0, 40).map(([key, item]) => [key, sanitizeApprovalArgs(item, depth + 1)]));
  }
  return String(value);
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
  private threadSwitchQueue: Promise<void> = Promise.resolve();
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
    retryMessageId: null,
    messages: [],
    events: [],
    interactions: [],
    resolvedInteractions: [],
    toolApproval: null,
    workbench: emptyWorkbench(),
    activeRun: null,
    error: null,
    revision: 0,
  };
  private runId: string | null = null;
  private runOutcome: "streaming" | "complete" | "interrupted" | "error" = "complete";
  private runError: RuntimeError | null = null;
  private sendGeneration = 0;
  private readonly steerAbortTokens = new Set<string>();
  private steerInFlight = false;
  private lastAssistantId: string | null = null;
  private readonly assistantProjections = new Map<string, LiveAssistantProjection>();
  private readonly persistedAssistantIds = new Map<string, Set<string>>();
  private readonly retiredAssistantIds = new Set<string>();
  private readonly optimisticUserMessages = new Map<string, { threadId: string; message: ChatMessage }>();
  private runStartedAt: string | null = null;
  private retryingText: string | null = null;
  private hideSingleRetry = false;
  private initializePromise: Promise<RuntimeSnapshot> | undefined;
  private runTerminalHandled = false;
  private danglingApprovalThreadId: string | null = null;
  private runClientMessageId: string | null = null;
  private startingRun = false;
  private startingRunId: string | null = null;
  private startingRunAbortRequested = false;
  private threadSelectionGeneration = 0;
  private threadStateSyncGeneration = 0;
  private pendingThreadSelectionId: string | null = null;

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
    this.snapshot = { ...this.snapshot, ...next, revision: this.snapshot.revision + 1 };
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

  private recordPersistedAssistantIds(threadId: string, rawMessages: MastraMessage[]): void {
    this.persistedAssistantIds.set(threadId, new Set(
      rawMessages.filter((message) => message.role === "assistant").map((message) => message.id),
    ));
  }

  private assistantBaselineForThread(threadId: string): Set<string> {
    return new Set([
      ...(this.persistedAssistantIds.get(threadId) ?? []),
      ...this.snapshot.messages.filter((message) => message.role === "assistant").map((message) => message.id),
    ]);
  }

  private startAssistantProjection(threadId: string, runId: string, turnId: string, runStartedAt: string): void {
    this.assistantProjections.set(runId, {
      runId,
      threadId,
      turnId,
      runStartedAt,
      baselineAssistantIds: this.assistantBaselineForThread(threadId),
      messages: new Map(),
      messageOrder: [],
      outcome: null,
    });
  }

  private updateAssistantProjection(threadId: string, message: ChatMessage): void {
    const runId = this.runId;
    if (!runId || threadId !== this.controllerThreadId) return;
    const projection = this.assistantProjections.get(runId);
    if (!projection) return;
    if (!projection.messages.has(message.id)) projection.messageOrder.push(message.id);
    projection.messages.set(message.id, message);
  }

  private updateProjectionTurnFromUserSignal(message: MastraMessage): void {
    if (chatRole(message) !== "user") return;
    const runId = this.runId;
    const threadId = this.controllerThreadId;
    if (!runId || !threadId || !this.assistantProjections.has(runId)) return;
    const projection = this.assistantProjections.get(runId);
    if (projection) projection.turnId = message.id;
  }

  private markAssistantProjectionOutcome(runId: string, status: ChatMessage["status"]): void {
    const projection = this.assistantProjections.get(runId);
    if (!projection) return;
    projection.outcome = status;
    const lastId = projection.messageOrder.at(-1);
    const last = lastId ? projection.messages.get(lastId) : undefined;
    if (last && lastId) projection.messages.set(lastId, { ...last, status });
  }

  private resetAssistantProjectionForSteer(threadId: string, runId: string, runStartedAt: string): string[] {
    const projection = this.assistantProjections.get(runId);
    const previousMessageIds = projection?.messageOrder ?? [];
    for (const messageId of previousMessageIds) this.retiredAssistantIds.add(messageId);
    this.assistantProjections.set(runId, {
      runId,
      threadId,
      turnId: projection?.turnId ?? this.runClientMessageId ?? runId,
      runStartedAt,
      baselineAssistantIds: this.assistantBaselineForThread(threadId),
      messages: new Map(),
      messageOrder: [],
      outcome: null,
    });
    return [...previousMessageIds];
  }

  private discardEmptyAssistantProjection(runId: string): void {
    const projection = this.assistantProjections.get(runId);
    if (projection && projection.messages.size === 0) this.assistantProjections.delete(runId);
  }

  private assistantProjectionsForThread(threadId: string): LiveAssistantProjection[] {
    return [...this.assistantProjections.values()]
      .filter((projection) => projection.threadId === threadId && projection.messages.size > 0)
      .sort((left, right) => left.runStartedAt.localeCompare(right.runStartedAt));
  }

  private workbenchFromState(state: PersistedThreadState, displayState: AgentControllerDisplayState | null, runStatus: RuntimeSnapshot["activeRun"] = this.snapshot.activeRun, toolApproval: ToolApproval | null = this.snapshot.toolApproval): WorkbenchState {
    const tasks = displayState ? projectTasks(displayState, state.tasks ?? []) : state.tasks ?? [];
    const pendingInteractions = state.pendingInteractions ?? [];
    const activeTools = displayState ? Array.from(displayState.activeTools.entries()).map(([id, tool]) => ({ id, name: tool.name, status: tool.status })) : [];
    const pending = pendingInteractions.length > 0 || toolApproval !== null;
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

  private async publishSelectedThread(threadId: string, options: { clearError?: boolean } = {}, generation = this.threadSelectionGeneration): Promise<void> {
    const session = this.requireSession();
    if (generation !== this.threadSelectionGeneration || (this.pendingThreadSelectionId !== null && this.pendingThreadSelectionId !== threadId)) return;
    const [rawMessages, state] = await Promise.all([
      session.thread.listMessages({ threadId }),
      this.loadThreadState(threadId),
    ]);
    if (generation !== this.threadSelectionGeneration || (this.pendingThreadSelectionId !== null && this.pendingThreadSelectionId !== threadId)) return;
    this.selectedThreadId = threadId;
    this.threadState = state;
    this.recordPersistedAssistantIds(threadId, rawMessages as MastraMessage[]);
    const messages = this.mergeTransientMessages(threadId, this.mapMessages(rawMessages), true);
    const displayState = this.displayStateForThread(threadId);
    const workbench = this.workbenchFromState(state, displayState, this.snapshot.activeRun, this.approvalFrom(displayState?.pendingApproval));
    const next: Partial<RuntimeSnapshot> = {
      activeThreadId: threadId,
      messages,
      events: state.events ?? [],
      interactions: state.pendingInteractions ?? [],
      resolvedInteractions: state.resolvedInteractions ?? [],
      toolApproval: this.approvalFrom(displayState?.pendingApproval),
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
      .map(({ message, role }) => {
        const approvalToolName = pendingApprovalToolName(message);
        const text = extractText(message) || (approvalToolName ? `The ${approvalToolName} request was interrupted before approval. Retry this turn to continue.` : "");
        return {
        id: message.id,
        role,
        text,
        status: approvalToolName ? "error" : (role === "assistant" && message.id === this.lastAssistantId && this.runOutcome === "streaming"
          ? "streaming"
          : role === "assistant" && message.id === this.lastAssistantId && this.runOutcome === "interrupted"
            ? "interrupted"
            : role === "assistant" && message.id === this.lastAssistantId && this.runOutcome === "error"
              ? "error"
              : "complete") as ChatMessage["status"],
        createdAt: isoDate(message.createdAt),
        retryable: approvalToolName ? true : role === "assistant" && message.id === this.lastAssistantId ? this.runError?.retryable : undefined,
      };
      })
      .filter((message) => message.text.length > 0);
  }

  private mergeTransientMessages(threadId: string, messages: ChatMessage[], reconcilePersisted = false): ChatMessage[] {
    let next = messages;
    for (const [id, optimistic] of this.optimisticUserMessages) {
      if (optimistic.threadId !== threadId) continue;
      const persisted = reconcilePersisted && next.some((message) => message.id === id);
      if (persisted) this.optimisticUserMessages.delete(id);
      else next = upsertChatMessage(next, optimistic.message);
    }

    const projections = this.assistantProjectionsForThread(threadId);
    for (const projection of projections) {
      const result = reconcileLiveAssistantTurn(next, projection, reconcilePersisted);
      next = result.messages;
      if (reconcilePersisted && result.settled) {
        this.assistantProjections.delete(projection.runId);
        if (result.persistedId) this.lastAssistantId = result.persistedId;
      }
    }
    return next;
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

  private async persistActiveThread(threadId = this.session?.thread.getId()): Promise<void> {
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

  private approvalFrom(value: { toolCallId: string; toolName: string; args: unknown } | null | undefined): ToolApproval | null {
    if (!value || typeof value.toolCallId !== "string" || typeof value.toolName !== "string") return null;
    return { toolCallId: value.toolCallId, toolName: value.toolName.slice(0, 120), args: sanitizeApprovalArgs(value.args) };
  }

  private publishLiveMessage(message: MastraMessage): void {
    if (message.role !== "assistant") return;
    if (this.retiredAssistantIds.has(message.id)) return;
    const runId = this.runId;
    const threadId = this.controllerThreadId;
    if (!runId || !threadId || this.selectedThreadId !== threadId || !this.assistantProjections.has(runId)) return;
    const messageCreatedAt = message.createdAt ? isoDate(message.createdAt) : null;
    const isCurrentRunMessage = !this.runStartedAt
      || !messageCreatedAt
      || messageCreatedAt >= this.runStartedAt
      || message.id === this.lastAssistantId;
    if (!isCurrentRunMessage) return;
    this.lastAssistantId = message.id;
    const live = this.mapMessages([message])[0];
    if (!live) return;
    this.updateAssistantProjection(threadId, live);
    this.publish({ messages: this.mergeTransientMessages(threadId, this.snapshot.messages) });
  }

  private handleControllerEvent(event: AgentControllerEvent): void {
    if (event.type === "display_state_changed") {
      this.displayState = event.displayState;
      const toolApproval = this.approvalFrom(event.displayState.pendingApproval);
      const threadId = this.controllerThreadId;
      if (threadId) {
        const tasks = projectTasks(event.displayState, this.controllerThreadState.tasks ?? []);
        const pendingInteractions = projectPendingInteractions(
          event.displayState,
          this.controllerThreadState.pendingInteractions ?? [],
          this.nextPlanVersion(),
        );
        this.controllerThreadState = { ...this.controllerThreadState, tasks, pendingInteractions, tokenUsage: event.displayState.tokenUsage };
        void this.persistThreadState(threadId, this.controllerThreadState);
        if (this.selectedThreadId === threadId) {
          this.threadState = this.controllerThreadState;
          const workbench = this.workbenchFromState(this.threadState, event.displayState, this.snapshot.activeRun, toolApproval);
          this.publish({
            messages: this.mergeTransientMessages(threadId, this.snapshot.messages),
            interactions: pendingInteractions,
            resolvedInteractions: this.controllerThreadState.resolvedInteractions ?? [],
            events: this.controllerThreadState.events ?? [],
            toolApproval,
            workbench,
          });
        }
      } else {
        this.publish({ toolApproval });
      }
      return;
    }

    if (event.type === "tool_approval_required") {
      this.runOutcome = "streaming";
      const toolApproval = this.approvalFrom(event);
      this.publish({
        toolApproval,
        status: "running",
        ...(this.runId ? { activeRun: { runId: this.runId, threadId: this.controllerThreadId ?? this.selectedThreadId ?? "unknown", status: "running" } } : {}),
      });
      if (this.controllerThreadId) this.updateThreadActivity(this.controllerThreadId, "waiting", 1);
      return;
    }

    if (event.type === "tool_suspended") {
      const interaction = parseSuspendedInteraction(event, this.nextPlanVersion());
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
      // replaces. Keep the handoff marker until that old terminal event is
      // observed; the replacement can start before the old stream reports its
      // abort, and clearing here would let the stale event terminate the new run.
      this.runOutcome = "streaming";
      this.runError = null;
      this.runTerminalHandled = false;
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
      if (event.reason === "aborted" && this.steerAbortTokens.size > 0) {
        const staleToken = this.steerAbortTokens.values().next().value as string | undefined;
        if (staleToken) this.steerAbortTokens.delete(staleToken);
        return;
      }
      if (event.reason === "suspended") {
        if (this.controllerThreadId) this.updateThreadActivity(this.controllerThreadId, "waiting", 1);
        return;
      }
      if (this.runTerminalHandled) return;
      this.runTerminalHandled = true;
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
        this.markAssistantProjectionOutcome(endedRunId, "complete");
        this.discardEmptyAssistantProjection(endedRunId);
        this.runId = null;
        this.runError = null;
        this.publish({ status: "ready", activeRun: null, error: null, toolApproval: null });
        this.updateThreadActivity(endedThreadId, "complete", 0);
        const selectionGeneration = this.threadSelectionGeneration;
        void this.settleAssistantProjectionAfterRun(endedThreadId, endedRunId, selectionGeneration);
      } else {
        void this.syncMessages().catch((error) => this.reportError(error));
        if (this.controllerThreadId) this.updateThreadActivity(this.controllerThreadId, this.runOutcome === "interrupted" ? "interrupted" : this.runOutcome === "error" ? "error" : "complete");
        if (endedRunId && this.runError && this.runOutcome !== "complete") void this.finishFailedRun(endedRunId, this.runError);
      }
      return;
    }

    if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
      this.updateProjectionTurnFromUserSignal(event.message);
      this.publishLiveMessage(event.message);
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

  private async syncMessagesSafely(threadId?: string, guard?: { selectionGeneration?: number; syncGeneration?: number }, assistantRunId?: string): Promise<boolean> {
    try {
      return await this.syncMessages(threadId, guard, assistantRunId);
    } catch (error) {
      this.reportError(error);
      return false;
    }
  }

  private async settleAssistantProjectionAfterRun(threadId: string, runId: string, selectionGeneration: number): Promise<void> {
    await this.retryAssistantProjectionPersistence(threadId, runId, selectionGeneration);
    await this.refreshThreadSummaries();
    if (this.selectedThreadId === threadId) await this.publishSelectedThread(threadId, { clearError: false }, selectionGeneration);
    await this.drainQueuedFollowUp(threadId);
  }

  private async retryAssistantProjectionPersistence(threadId: string, runId: string, selectionGeneration: number): Promise<void> {
    const retryDelays = [0, 50, 150, 400, 1_000];
    for (const delay of retryDelays) {
      if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      if (!this.assistantProjections.has(runId)) break;
      await this.syncMessagesSafely(threadId, { selectionGeneration }, runId);
      if (!this.assistantProjections.has(runId)) break;
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

  private async syncMessages(
    threadId = this.selectedThreadId ?? this.controllerThreadId ?? undefined,
    guard?: { selectionGeneration?: number; syncGeneration?: number },
    assistantRunId?: string,
  ): Promise<boolean> {
    if (!threadId) {
      if (guard && (guard.selectionGeneration !== undefined && guard.selectionGeneration !== this.threadSelectionGeneration || guard.syncGeneration !== undefined && guard.syncGeneration !== this.threadStateSyncGeneration)) return false;
      this.publish({ messages: [] });
      return true;
    }
    const rawMessages = (await this.requireSession().thread.listMessages({ threadId })) as MastraMessage[];
    if (guard && (guard.selectionGeneration !== undefined && guard.selectionGeneration !== this.threadSelectionGeneration || guard.syncGeneration !== undefined && guard.syncGeneration !== this.threadStateSyncGeneration)) return false;
    this.recordPersistedAssistantIds(threadId, rawMessages);
    const messages = this.mergeTransientMessages(threadId, this.mapMessages(rawMessages), true);
    if (threadId === this.selectedThreadId) {
      this.publish({ messages });
      if (!this.runId && rawMessages.some((message) => pendingApprovalToolName(message))) {
        if (this.danglingApprovalThreadId !== threadId) {
          this.danglingApprovalThreadId = threadId;
          this.publish({ error: { code: "unknown", message: "A previous tool approval was interrupted. Retry the last turn to continue.", retryable: true } });
        }
      } else if (this.danglingApprovalThreadId === threadId) {
        this.danglingApprovalThreadId = null;
      }
    }
    return assistantRunId ? !this.assistantProjections.has(assistantRunId) : true;
  }

  private async syncThreadState(
    options: { clearError?: boolean } = {},
    selectionGeneration = this.threadSelectionGeneration,
  ): Promise<void> {
    const syncGeneration = ++this.threadStateSyncGeneration;
    const session = this.requireSession();
    const threads = (await session.thread.list()).map((thread) => {
      const summary = mapThread(thread);
      const activity = this.threadActivity.get(summary.id);
      return activity ? { ...summary, ...activity } : summary;
    }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const activeThreadId = session.thread.getId();
    if (
      selectionGeneration !== this.threadSelectionGeneration
      || syncGeneration !== this.threadStateSyncGeneration
      || (this.pendingThreadSelectionId !== null && this.pendingThreadSelectionId !== activeThreadId)
    ) return;
    const selectedModelId = modelFromSession(session.model.get());
    const nextThreadState = activeThreadId ? await this.loadThreadState(activeThreadId) : {};
    if (
      selectionGeneration !== this.threadSelectionGeneration
      || syncGeneration !== this.threadStateSyncGeneration
      || (this.pendingThreadSelectionId !== null && this.pendingThreadSelectionId !== activeThreadId)
    ) return;
    const previousControllerThreadId = this.controllerThreadId;
    if (activeThreadId !== previousControllerThreadId) this.displayState = null;
    for (const [id, optimistic] of this.optimisticUserMessages) {
      if (optimistic.threadId !== activeThreadId) this.optimisticUserMessages.delete(id);
    }
    if (activeThreadId !== previousControllerThreadId) this.runStartedAt = null;
    this.controllerThreadId = activeThreadId;
    this.selectedThreadId = activeThreadId;
    this.threadState = nextThreadState;
    this.controllerThreadState = nextThreadState;
    const nextSnapshot: Partial<RuntimeSnapshot> = {
      threads,
      activeThreadId,
      selectedModelId,
      messages: [],
      events: nextThreadState.events ?? [],
      interactions: nextThreadState.pendingInteractions ?? [],
      resolvedInteractions: nextThreadState.resolvedInteractions ?? [],
      toolApproval: null,
      workbench: this.workbenchFromState(nextThreadState, this.displayState),
    };
    if (options.clearError !== false) nextSnapshot.error = null;
    this.publish(nextSnapshot);
    void this.persistActiveThread(activeThreadId);
    await this.syncMessages(activeThreadId ?? undefined, { selectionGeneration, syncGeneration });
  }

  private enqueueThreadSwitch(operation: () => Promise<void>): Promise<void> {
    const next = this.threadSwitchQueue.catch(() => undefined).then(operation);
    this.threadSwitchQueue = next.catch(() => undefined);
    return next;
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
        for (const toolName of INTERNAL_TOOL_GRANTS) this.session.grantTool(toolName);
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
    if (this.startingRun) throw makeRuntimeError("busy");
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
    if (this.startingRun) throw makeRuntimeError("busy");
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
    if (this.startingRun || this.runId) throw makeRuntimeError("busy");
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
    if (this.startingRun || this.runId) throw makeRuntimeError("busy");
    if (modelId !== DEFAULT_MODEL_ID && !this.snapshot.models.some((model) => model.id === modelId)) throw makeRuntimeError("model-unavailable");
    await session.model.switch({ modelId, scope: "thread" });
    await this.syncThreadState();
  }

  async createThread(title?: string): Promise<string> {
    const session = await this.ensureInitialized();
    if (this.startingRun || this.runId) throw makeRuntimeError("busy");
    const thread = await session.thread.create({ title: title?.trim() || "New chat" });
    await this.syncThreadState();
    return thread.id;
  }

  async selectThread(threadId: string): Promise<void> {
    if (this.startingRun) throw makeRuntimeError("busy");
    const generation = ++this.threadSelectionGeneration;
    this.pendingThreadSelectionId = threadId;
    try {
      const session = await this.ensureInitialized();
      if (this.startingRun) throw makeRuntimeError("busy");
      const thread = await session.thread.getById({ threadId });
      if (!thread) throw new Error("Conversation not found");
      if (generation !== this.threadSelectionGeneration) return;
      if (this.startingRun) throw makeRuntimeError("busy");

      if (this.runId && threadId !== this.controllerThreadId) {
        await this.publishSelectedThread(threadId, {}, generation);
        if (generation !== this.threadSelectionGeneration) return;
        this.pendingThreadSelectionId = null;
        this.updateThreadActivity(this.controllerThreadId ?? "", "running", 0);
        return;
      }

      if (threadId === this.controllerThreadId) {
        await this.publishSelectedThread(threadId, {}, generation);
        if (generation === this.threadSelectionGeneration) this.pendingThreadSelectionId = null;
        return;
      }

      await this.enqueueThreadSwitch(async () => {
        if (generation !== this.threadSelectionGeneration) return;
        if (this.startingRun) throw makeRuntimeError("busy");
        if (this.runId) {
          await this.publishSelectedThread(threadId, {}, generation);
          if (generation !== this.threadSelectionGeneration) return;
          this.pendingThreadSelectionId = null;
          this.updateThreadActivity(this.controllerThreadId ?? "", "running", 0);
          return;
        }
        await session.thread.switch({ threadId });
        if (generation !== this.threadSelectionGeneration) return;
        await this.syncThreadState({}, generation);
        if (generation === this.threadSelectionGeneration) this.pendingThreadSelectionId = null;
      });
    } finally {
      if (generation === this.threadSelectionGeneration && this.pendingThreadSelectionId === threadId) this.pendingThreadSelectionId = null;
    }
  }

  async switchThread(threadId: string): Promise<void> {
    await this.selectThread(threadId);
  }

  async renameThread(threadId: string, title: string): Promise<void> {
    const session = await this.ensureInitialized();
    if (this.startingRun || this.runId) throw makeRuntimeError("busy");
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
    if (this.startingRun || this.runId) throw makeRuntimeError("busy");
    await session.thread.delete({ threadId });
    const remaining = (await session.thread.list()).map(mapThread).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    if (!session.thread.getId()) {
      if (remaining[0]) await session.thread.switch({ threadId: remaining[0].id });
      else await session.thread.create({ title: "New chat" });
    }
    await this.syncThreadState();
  }

  async send(text: string, clientMessageId?: string): Promise<{ runId: string }> {
    const candidate = text.trim();
    if (!candidate) throw new Error("Message cannot be empty");
    if (candidate.length > MAX_INPUT_LENGTH) throw new Error(`Message must be ${MAX_INPUT_LENGTH} characters or fewer`);
    const messageId = clientMessageId?.trim() || randomUUID();
    if (this.startingRun || this.pendingThreadSelectionId !== null) throw makeRuntimeError("busy");
    this.startingRun = true;
    this.startingRunAbortRequested = false;
    const targetThreadId = this.selectedThreadId ?? this.controllerThreadId ?? this.snapshot.activeThreadId;
    const reservationId = !this.runId && targetThreadId ? `starting:${messageId}` : null;
    this.startingRunId = reservationId;
    if (reservationId && targetThreadId) this.publish({ status: "running", activeRun: { runId: reservationId, threadId: targetThreadId, status: "running" }, error: null, retryMessageId: null });
    return this.sendReserved(candidate, messageId, targetThreadId).finally(() => {
      const abortedBeforeStart = this.startingRunAbortRequested;
      this.startingRun = false;
      this.startingRunAbortRequested = false;
      if (this.startingRunId !== reservationId) return;
      this.startingRunId = null;
      if (reservationId && this.runId === null && this.snapshot.activeRun?.runId === reservationId) {
        this.publish({ status: this.snapshot.credential.verified ? "ready" : "needs-key", activeRun: null, ...(abortedBeforeStart ? { error: makeRuntimeError("aborted") } : {}) });
      }
    });
  }

  private async sendReserved(candidate: string, messageId: string, reservedThreadId: string | null): Promise<{ runId: string }> {
    await this.ensureInitialized();
    if (!this.snapshot.credential.configured || !this.snapshot.credential.verified) throw makeRuntimeError("invalid-credential");
    if (this.snapshot.status === "error" && this.snapshot.error?.code === "model-unavailable") throw makeRuntimeError("model-unavailable");
    this.retryingText = null;
    this.hideSingleRetry = false;

    const session = this.requireSession();
    if (this.runId) {
      if (this.selectedThreadId !== this.controllerThreadId) throw makeRuntimeError("busy");
      const threadId = this.controllerThreadId;
      if (!threadId) throw makeRuntimeError("busy");
      const queued: QueuedFollowUp = { id: messageId, content: candidate, createdAt: new Date().toISOString() };
      this.controllerThreadState = { ...this.controllerThreadState, queuedFollowUps: [...(this.controllerThreadState.queuedFollowUps ?? []), queued] };
      this.optimisticUserMessages.set(messageId, {
        threadId,
        message: { id: messageId, role: "user", text: candidate, status: "complete", createdAt: queued.createdAt },
      });
      await this.persistThreadState(threadId, this.controllerThreadState);
      this.threadState = this.controllerThreadState;
      this.publish({ messages: this.mergeTransientMessages(threadId, this.snapshot.messages), workbench: this.workbenchFromState(this.controllerThreadState, this.displayState) });
      return { runId: this.runId };
    }

    if (reservedThreadId && session.thread.getId() !== reservedThreadId) {
      await session.thread.switch({ threadId: reservedThreadId });
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
    if (this.startingRunAbortRequested) throw makeRuntimeError("aborted");
    return this.startRun(candidate, { optimistic: true, clientMessageId: messageId });
  }

  private startRun(candidate: string, options: { optimistic?: boolean; clientMessageId?: string } = {}): { runId: string } {
    const session = this.requireSession();
    const threadId = this.controllerThreadId ?? session.thread.getId();
    if (!threadId) throw new Error("No active conversation");
    const runId = randomUUID();
    const sendGeneration = ++this.sendGeneration;
    this.runId = runId;
    this.lastAssistantId = null;
    this.runStartedAt = new Date().toISOString();
    this.runOutcome = "streaming";
    this.runError = null;
    this.runTerminalHandled = false;
    this.danglingApprovalThreadId = null;
    const messageId = options.clientMessageId ?? randomUUID();
    this.startAssistantProjection(threadId, runId, messageId, this.runStartedAt);
    this.runClientMessageId = options.optimistic ? messageId : null;
    if (options.optimistic) {
      const createdAt = this.runStartedAt;
      this.optimisticUserMessages.set(messageId, {
        threadId,
        message: { id: messageId, role: "user", text: candidate, status: "complete", createdAt },
      });
    }
    this.publish({
      status: "running",
      activeRun: { runId, threadId, status: "running" },
      error: null,
      retryMessageId: null,
      messages: this.mergeTransientMessages(threadId, this.snapshot.messages, true),
    });
    this.updateThreadActivity(threadId, "running");

    try {
      const signal = session.sendSignal({
        id: messageId,
        createdAt: this.runStartedAt,
        type: "user",
        contents: candidate,
      }, { requireDelivery: true });
      void signal.accepted.catch(async (error) => {
        if (this.runId !== runId || this.sendGeneration !== sendGeneration) return;
        await this.finishFailedRun(runId, normalizeError(error));
      });
    } catch (error) {
      void this.finishFailedRun(runId, normalizeError(error));
    }

    return { runId };
  }

  private async drainQueuedFollowUp(threadId: string): Promise<void> {
    if (this.runId || threadId !== this.controllerThreadId) return;
    const next = this.controllerThreadState.queuedFollowUps?.[0];
    if (!next) return;
    this.startRun(next.content, { optimistic: true, clientMessageId: next.id });
    this.controllerThreadState = {
      ...this.controllerThreadState,
      queuedFollowUps: (this.controllerThreadState.queuedFollowUps ?? []).slice(1),
    };
    await this.persistThreadState(threadId, this.controllerThreadState);
    if (this.selectedThreadId === threadId) this.threadState = this.controllerThreadState;
    if (this.selectedThreadId === threadId) this.publish({ workbench: this.workbenchFromState(this.controllerThreadState, this.displayState) });
  }

  async steer(text: string): Promise<{ runId: string }> {
    if (this.steerInFlight) throw makeRuntimeError("busy");
    this.steerInFlight = true;
    try {
      return await this.steerReserved(text);
    } catch (error) {
      this.steerInFlight = false;
      throw error;
    }
  }

  private async steerReserved(text: string): Promise<{ runId: string }> {
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
    for (const item of cleared) this.optimisticUserMessages.delete(item.id);
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
    void this.persistThreadState(threadId, this.controllerThreadState);
    if (this.runId !== runId || this.controllerThreadId !== threadId || this.selectedThreadId !== threadId) {
      throw makeRuntimeError("busy");
    }
    this.threadState = this.controllerThreadState;
    const steerStartedAt = new Date().toISOString();
    const retiredMessageIds = this.resetAssistantProjectionForSteer(threadId, runId, steerStartedAt);
    this.runStartedAt = steerStartedAt;
    this.lastAssistantId = null;
    this.runOutcome = "streaming";
    this.runError = null;
    this.sendGeneration += 1;
    const messagesAfterSteer = this.snapshot.messages.filter((message) =>
      !cleared.some((item) => item.id === message.id)
      && !retiredMessageIds.includes(message.id),
    );
    this.publish({
      status: "running",
      error: null,
      messages: this.mergeTransientMessages(threadId, messagesAfterSteer),
      events: this.controllerThreadState.events ?? [],
      interactions: [],
      resolvedInteractions: this.controllerThreadState.resolvedInteractions ?? [],
      workbench: this.workbenchFromState(this.controllerThreadState, this.displayState),
    });
    let expectsAbortedTerminal = false;
    const steerToken = randomUUID();
    try {
      const session = this.requireSession();
      expectsAbortedTerminal = session.stream.isActive();
      if (expectsAbortedTerminal) this.steerAbortTokens.add(steerToken);
      void session.steer({ content: candidate }).catch(async (error) => {
        if (expectsAbortedTerminal) this.steerAbortTokens.delete(steerToken);
        if (this.runId === runId) await this.finishFailedRun(runId, normalizeError(error));
      }).finally(() => { this.steerInFlight = false; });
    } catch (error) {
      if (expectsAbortedTerminal) this.steerAbortTokens.delete(steerToken);
      this.steerInFlight = false;
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

  async respondToToolApproval(toolCallId: string, approved: boolean): Promise<void> {
    const session = await this.ensureInitialized();
    const pending = this.snapshot.toolApproval;
    if (!pending || pending.toolCallId !== toolCallId) throw new Error("That tool approval is no longer available");
    try {
      session.respondToToolApproval({ decision: approved ? "approve" : "decline", toolCallId });
      this.publish({ toolApproval: null });
      if (this.controllerThreadId) this.updateThreadActivity(this.controllerThreadId, "running", 0);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async updateQueuedFollowUp(id: string, content: string): Promise<void> {
    await this.ensureInitialized();
    const nextContent = content.trim();
    if (!nextContent) throw new Error("Queued message cannot be empty");
    const queue = this.controllerThreadState.queuedFollowUps ?? [];
    if (!queue.some((item) => item.id === id)) throw new Error("Queued message not found");
    this.controllerThreadState = { ...this.controllerThreadState, queuedFollowUps: queue.map((item) => item.id === id ? { ...item, content: nextContent } : item) };
    const optimistic = this.optimisticUserMessages.get(id);
    if (optimistic) this.optimisticUserMessages.set(id, { ...optimistic, message: { ...optimistic.message, text: nextContent } });
    const threadId = this.controllerThreadId ?? this.selectedThreadId ?? "";
    await this.persistThreadState(threadId, this.controllerThreadState);
    if (this.selectedThreadId === this.controllerThreadId && threadId) this.publish({ messages: this.mergeTransientMessages(threadId, this.snapshot.messages), workbench: this.workbenchFromState(this.controllerThreadState, this.displayState) });
  }

  async removeQueuedFollowUp(id: string): Promise<void> {
    await this.ensureInitialized();
    const queue = this.controllerThreadState.queuedFollowUps ?? [];
    if (!queue.some((item) => item.id === id)) throw new Error("Queued message not found");
    this.controllerThreadState = { ...this.controllerThreadState, queuedFollowUps: queue.filter((item) => item.id !== id) };
    this.optimisticUserMessages.delete(id);
    const threadId = this.controllerThreadId ?? this.selectedThreadId ?? "";
    await this.persistThreadState(threadId, this.controllerThreadState);
    if (this.selectedThreadId === this.controllerThreadId && threadId) this.publish({ messages: this.mergeTransientMessages(threadId, this.snapshot.messages.filter((message) => message.id !== id)), workbench: this.workbenchFromState(this.controllerThreadState, this.displayState) });
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
    const threadId = this.controllerThreadId ?? this.selectedThreadId;
    if (threadId) this.optimisticUserMessages.set(item.id, { threadId, message: { id: item.id, role: "user", text: item.content, status: "complete", createdAt: item.createdAt } });
    await this.persistThreadState(this.controllerThreadId ?? this.selectedThreadId ?? "", this.controllerThreadState);
    if (this.selectedThreadId === this.controllerThreadId && threadId) this.publish({ messages: this.mergeTransientMessages(threadId, this.snapshot.messages), workbench: this.workbenchFromState(this.controllerThreadState, this.displayState) });
  }

  async retry(messageId: string): Promise<{ runId: string }> {
    if (this.startingRun || this.runId || this.pendingThreadSelectionId !== null) throw makeRuntimeError("busy");
    this.startingRun = true;
    this.startingRunAbortRequested = false;
    const reservationThreadId = this.selectedThreadId ?? this.controllerThreadId ?? this.snapshot.activeThreadId;
    const reservationId = reservationThreadId ? `starting:retry:${randomUUID()}` : null;
    this.startingRunId = reservationId;
    if (reservationId && reservationThreadId) {
      this.publish({ status: "running", activeRun: { runId: reservationId, threadId: reservationThreadId, status: "running" }, error: null, retryMessageId: null });
    }
    try {
      return await this.retryReserved(messageId);
    } finally {
      const abortedBeforeStart = this.startingRunAbortRequested;
      this.startingRun = false;
      this.startingRunAbortRequested = false;
      if (this.startingRunId === reservationId) {
        this.startingRunId = null;
        if (reservationId && this.runId === null && this.snapshot.activeRun?.runId === reservationId) {
          this.publish({ status: this.snapshot.credential.verified ? "ready" : "needs-key", activeRun: null, ...(abortedBeforeStart ? { error: makeRuntimeError("aborted") } : {}) });
        }
      }
    }
  }

  private async retryReserved(messageId: string): Promise<{ runId: string }> {
    await this.ensureInitialized();
    if (this.runId) throw makeRuntimeError("busy");
    const session = this.requireSession();
    const sourceThreadId = this.selectedThreadId ?? this.controllerThreadId ?? "";
    const messages = (await session.thread.listMessages({ threadId: sourceThreadId })) as MastraMessage[];
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
    const optimistic = !source ? this.optimisticUserMessages.get(messageId) : undefined;
    const content = source ? extractText(source) : optimistic?.message.text;
    if (!content) throw new Error("The original user message could not be recovered");
    if (this.startingRunAbortRequested) throw makeRuntimeError("aborted");
    if (!source) {
      this.retryingText = null;
      this.hideSingleRetry = false;
      return this.startRun(content, { optimistic: true, clientMessageId: messageId });
    }
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
    if (this.startingRunAbortRequested) throw makeRuntimeError("aborted");
    await this.syncThreadState();
    if (this.startingRunAbortRequested) throw makeRuntimeError("aborted");
    this.retryingText = null;
    this.hideSingleRetry = false;
    return this.startRun(content, { optimistic: true });
  }

  async continueFrom(messageId: string): Promise<{ runId: string }> {
    if (this.startingRun || this.runId || this.pendingThreadSelectionId !== null) throw makeRuntimeError("busy");
    this.startingRun = true;
    this.startingRunAbortRequested = false;
    const reservationThreadId = this.selectedThreadId ?? this.controllerThreadId ?? this.snapshot.activeThreadId;
    const reservationId = reservationThreadId ? `starting:continue:${randomUUID()}` : null;
    this.startingRunId = reservationId;
    if (reservationId && reservationThreadId) {
      this.publish({ status: "running", activeRun: { runId: reservationId, threadId: reservationThreadId, status: "running" }, error: null, retryMessageId: null });
    }
    try {
      return await this.continueReserved(messageId);
    } finally {
      const abortedBeforeStart = this.startingRunAbortRequested;
      this.startingRun = false;
      this.startingRunAbortRequested = false;
      if (this.startingRunId === reservationId) {
        this.startingRunId = null;
        if (reservationId && this.runId === null && this.snapshot.activeRun?.runId === reservationId) {
          this.publish({ status: this.snapshot.credential.verified ? "ready" : "needs-key", activeRun: null, ...(abortedBeforeStart ? { error: makeRuntimeError("aborted") } : {}) });
        }
      }
    }
  }

  private async continueReserved(messageId: string): Promise<{ runId: string }> {
    await this.ensureInitialized();
    if (this.runId) throw makeRuntimeError("busy");
    if (this.startingRunAbortRequested) throw makeRuntimeError("aborted");
    const message = this.snapshot.messages.find((item) => item.id === messageId);
    if (!message) throw new Error("Stopped response not found");
    const continuation = "Continue from the stopped response without repeating what is already visible. Finish the answer naturally.";
    this.retryingText = continuation;
    this.hideSingleRetry = true;
    return this.startRun(continuation);
  }

  abort(): void {
    if (!this.runId) {
      if (this.startingRun && this.startingRunId && this.snapshot.activeRun?.runId === this.startingRunId) {
        this.startingRunAbortRequested = true;
        this.publish({ activeRun: { runId: this.startingRunId, threadId: this.snapshot.activeRun.threadId, status: "aborted" }, error: makeRuntimeError("aborted") });
      }
      return;
    }
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
    const selectionGeneration = this.threadSelectionGeneration;
    this.runOutcome = normalized.code === "aborted" ? "interrupted" : "error";
    this.runError = normalized;
    this.runTerminalHandled = true;
    this.markAssistantProjectionOutcome(runId, normalized.code === "aborted" ? "interrupted" : "error");
    this.discardEmptyAssistantProjection(runId);
    this.runId = null;
    const retryMessageId = this.runClientMessageId;
    this.runClientMessageId = null;
    const failedThreadId = this.controllerThreadId ?? this.selectedThreadId ?? "unknown";
    this.publish({
      status: normalized.code === "offline" ? "offline" : normalized.code === "secure-store-unavailable" ? "error" : normalized.code === "invalid-credential" ? "needs-key" : "ready",
      activeRun: null,
      error: normalized,
      retryMessageId,
      ...(normalized.code === "invalid-credential" ? { credential: { configured: true, verified: false } } : {}),
    });
    this.updateThreadActivity(failedThreadId, normalized.code === "aborted" ? "interrupted" : "error");
    await this.retryAssistantProjectionPersistence(failedThreadId, runId, selectionGeneration);
    await this.refreshThreadSummaries();
    if (this.selectedThreadId === failedThreadId) await this.publishSelectedThread(failedThreadId, { clearError: false }, selectionGeneration);
    const outcome = normalized.code === "aborted" ? "interrupted" : "error";
    if (
      selectionGeneration === this.threadSelectionGeneration
      && this.selectedThreadId === failedThreadId
      && this.runId === null
      && this.runOutcome === outcome
      && this.runError?.code === normalized.code
    ) {
      this.publish({
        status: normalized.code === "offline" ? "offline" : normalized.code === "secure-store-unavailable" ? "error" : normalized.code === "invalid-credential" ? "needs-key" : "ready",
        activeRun: null,
        error: normalized,
        retryMessageId,
        ...(normalized.code === "invalid-credential" ? { credential: { configured: true, verified: false } } : {}),
      });
    }
  }
}
