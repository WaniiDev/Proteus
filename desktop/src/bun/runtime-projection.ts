import type { AgentControllerDisplayState } from "@mastra/core/agent-controller";
import type { ChatMessage, ChatToolPart, PendingInteraction, WorkbenchTask } from "../shared/contracts";

type TaskLike = { id?: unknown; content?: unknown; activeForm?: unknown; status?: unknown };

type SuspendedToolLike = {
  toolCallId: string;
  toolName: string;
  suspendPayload: unknown;
};

type StoredMessageIdentity = {
  id: string;
  role?: string;
  content?: unknown;
  metadata?: unknown;
};

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/**
 * Preserve the renderer's optimistic id after Mastra stores a user-authored
 * queue signal under its own native signal id. Mastra persists message
 * metadata below content.metadata.signal.metadata for signal rows.
 */
export function projectedMessageId(message: StoredMessageIdentity, projectedRole: string): string {
  if (projectedRole !== "user") return message.id;
  const contentMetadata = objectRecord(objectRecord(message.content)?.metadata);
  const signalMetadata = objectRecord(objectRecord(contentMetadata?.signal)?.metadata);
  const topLevelMetadata = objectRecord(message.metadata);
  const candidate = signalMetadata?.clientMessageId ?? contentMetadata?.clientMessageId ?? topLevelMetadata?.clientMessageId;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : message.id;
}

const LEGACY_TASK_POLICY_MESSAGES = new Set([
  "This exact task mutation already ran. Use the current task state and continue without repeating it.",
  "Task tools made no progress repeatedly. Stop using task tools and answer the user with the current result.",
]);

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function taskToolSignature(part: ChatToolPart): string {
  return `${part.name}:${stableValue(part.input)}`;
}

function taskOutputContent(part: ChatToolPart): string | null {
  if (typeof part.error === "string") return part.error;
  if (!part.output || typeof part.output !== "object") return null;
  const content = (part.output as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

function completedTaskCheckKey(part: ChatToolPart): string | null {
  if (part.name !== "task_check" || part.status !== "completed" || !part.output || typeof part.output !== "object") return null;
  const output = part.output as { summary?: { allCompleted?: unknown }; tasks?: unknown };
  return output.summary?.allCompleted === true ? stableValue(output.tasks) : null;
}

/**
 * Hide only artifacts emitted by Proteus' retired task-loop guard. This is a
 * read projection: durable Mastra history remains untouched, and native task
 * errors continue to render.
 */
export function normalizeLegacyTaskToolArtifacts(messages: ChatMessage[]): ChatMessage[] {
  const successfulByTurn = new Map<string, Set<string>>();
  const completedChecksByTurn = new Map<string, Set<string>>();

  return messages.flatMap((message) => {
    const successes = successfulByTurn.get(message.turnId) ?? new Set<string>();
    const completedChecks = completedChecksByTurn.get(message.turnId) ?? new Set<string>();
    const parts = message.parts.filter((part) => {
      if (part.type !== "tool" || !part.name.startsWith("task_")) return true;
      const signature = taskToolSignature(part);
      const legacyError = part.status === "error" && LEGACY_TASK_POLICY_MESSAGES.has(taskOutputContent(part) ?? "");
      if (legacyError && successes.has(signature)) return false;

      const completedCheck = completedTaskCheckKey(part);
      if (completedCheck !== null && completedChecks.has(completedCheck)) return false;
      if (completedCheck !== null) completedChecks.add(completedCheck);

      if (part.status === "completed" && (part.output as { isError?: unknown } | undefined)?.isError !== true) successes.add(signature);
      return true;
    });
    successfulByTurn.set(message.turnId, successes);
    completedChecksByTurn.set(message.turnId, completedChecks);
    return parts.length > 0 ? [{ ...message, parts }] : [];
  });
}

export type ProjectedToolOutcome = {
  status: Extract<ChatToolPart["status"], "completed" | "error" | "cancelled" | "declined">;
  output?: unknown;
  error?: string;
};

type HistoricalMessageLike = {
  role: string;
  type?: string;
  content?: unknown;
};

function messageParts(content: unknown): unknown[] {
  if (Array.isArray(content)) return content;
  if (!content || typeof content !== "object") return [];
  const parts = (content as { parts?: unknown }).parts;
  return Array.isArray(parts) ? parts : [];
}

function taskSignalTasks(message: HistoricalMessageLike): WorkbenchTask[] | null {
  if (message.role !== "signal" || !message.content || typeof message.content !== "object") return null;
  const signal = (message.content as { metadata?: { signal?: { tagName?: unknown; metadata?: { value?: { tasks?: unknown } } } } }).metadata?.signal;
  const tagName = typeof signal?.tagName === "string" ? signal.tagName : message.type;
  if (tagName !== "current-task-list" && tagName !== "task-list-update") return null;
  const tasks = signal?.metadata?.value?.tasks;
  if (!Array.isArray(tasks)) return null;
  const projected = tasks.map(taskFromMastra).filter((task): task is WorkbenchTask => task !== null);
  return projected.length === tasks.length ? projected : null;
}

function pendingTaskCalls(message: HistoricalMessageLike): Array<{ toolCallId: string; toolName: string }> {
  if (message.role !== "assistant") return [];
  return messageParts(message.content).flatMap((part): Array<{ toolCallId: string; toolName: string }> => {
    if (!part || typeof part !== "object") return [];
    const record = part as Record<string, unknown>;
    if (record.type === "tool-invocation" && record.toolInvocation && typeof record.toolInvocation === "object") {
      const invocation = record.toolInvocation as Record<string, unknown>;
      return typeof invocation.toolCallId === "string" && typeof invocation.toolName === "string" && invocation.toolName.startsWith("task_") && invocation.result === undefined
        ? [{ toolCallId: invocation.toolCallId, toolName: invocation.toolName }]
        : [];
    }
    if (typeof record.type !== "string" || !record.type.startsWith("tool-")) return [];
    const toolName = typeof record.toolName === "string" ? record.toolName : record.type.slice(5);
    const state = String(record.state ?? record.status ?? "").toLowerCase();
    return typeof record.toolCallId === "string" && toolName.startsWith("task_") && !/output|result|complete|error/.test(state)
      ? [{ toolCallId: record.toolCallId, toolName }]
      : [];
  });
}

/** Project successful native task signals back onto their originating calls. */
export function historicalTaskToolOutcomes(messages: HistoricalMessageLike[]): Map<string, ProjectedToolOutcome> {
  const outcomes = new Map<string, ProjectedToolOutcome>();
  let pending: Array<{ toolCallId: string; toolName: string }> = [];
  for (const message of messages) {
    if (message.role === "user") pending = [];
    pending.push(...pendingTaskCalls(message));
    const tasks = taskSignalTasks(message);
    if (!tasks || pending.length === 0) continue;
    const completed = tasks.filter((task) => task.status === "completed").length;
    const inProgress = tasks.filter((task) => task.status === "in_progress").length;
    const summary = {
      total: tasks.length,
      completed,
      inProgress,
      pending: tasks.length - completed - inProgress,
      incomplete: tasks.length - completed,
      hasTasks: tasks.length > 0,
      allCompleted: tasks.length > 0 && completed === tasks.length,
    };
    for (const call of pending) {
      outcomes.set(call.toolCallId, {
        status: "completed",
        output: {
          content: "Task state recorded by Mastra.",
          tasks,
          isError: false,
          ...(call.toolName === "task_check" ? { summary } : {}),
        },
      });
    }
    pending = [];
  }
  return outcomes;
}

export function applyToolOutcomes(messages: ChatMessage[], outcomes: ReadonlyMap<string, ProjectedToolOutcome>): ChatMessage[] {
  if (outcomes.size === 0) return messages;
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.type !== "tool") return part;
      const outcome = outcomes.get(part.toolCallId);
      return outcome ? { ...part, ...outcome } : part;
    }),
  }));
}

export type InteractionToolOutcome = {
  status: Extract<ChatToolPart["status"], "completed" | "error" | "cancelled" | "declined">;
  toolCallId: string;
  decision?: "approved" | "rejected";
};

export function submitPlanDecision(value: unknown): "approved" | "rejected" | null {
  if (!value || typeof value !== "object") return null;
  const content = (value as { content?: unknown }).content;
  if (typeof content !== "string") return null;
  if (content === "The user approved the plan. Continue with the approved work." || content.startsWith("Plan approved.")) return "approved";
  if (content.startsWith("The user requested plan changes") || content.startsWith("Plan was not approved.")) return "rejected";
  return null;
}

export function submitPlanResolutionResult(decision: "approved" | "rejected", feedback?: string): { content: string } {
  return {
    content: decision === "approved"
      ? "The user approved the plan. Continue with the approved work."
      : `The user requested plan changes${feedback ? `: ${feedback}` : "."}`,
  };
}

/**
 * Mastra can persist a resumed submit_plan result under a fresh tool-call ID.
 * Exact IDs remain authoritative; aliases are accepted only for the trusted
 * submit_plan result contract within the interaction's originating turn.
 */
export function findInteractionToolOutcome(
  messages: ChatMessage[],
  interaction: PendingInteraction,
  expectedDecision?: "approved" | "rejected",
): InteractionToolOutcome | null {
  const parts = messages
    .filter((message) => message.role === "assistant" && (!interaction.originMessageId || message.turnId === interaction.originMessageId))
    .flatMap((message) => message.parts)
    .filter((part): part is ChatToolPart => part.type === "tool" && part.name === (interaction.kind === "submit_plan" ? "submit_plan" : "ask_user"));
  const terminal = (part: ChatToolPart) => part.status === "completed" || part.status === "error" || part.status === "cancelled" || part.status === "declined";
  const exact = parts.find((part) => part.toolCallId === interaction.toolCallId && terminal(part));
  if (exact) return { status: exact.status as InteractionToolOutcome["status"], toolCallId: exact.toolCallId, ...(exact.status === "completed" && interaction.kind === "submit_plan" ? { decision: submitPlanDecision(exact.output) ?? undefined } : {}) };
  if (interaction.kind !== "submit_plan") return null;
  const aliases = parts.flatMap((part): InteractionToolOutcome[] => {
    if (!terminal(part)) return [];
    const decision = part.status === "completed" ? submitPlanDecision(part.output) : null;
    if (!decision || (expectedDecision && decision !== expectedDecision)) return [];
    return [{ status: part.status as InteractionToolOutcome["status"], toolCallId: part.toolCallId, decision }];
  });
  return aliases.length === 1 ? aliases[0] : null;
}

function taskFromMastra(task: TaskLike): WorkbenchTask | null {
  if (typeof task.id !== "string" || typeof task.content !== "string" || typeof task.activeForm !== "string") return null;
  if (task.status !== "pending" && task.status !== "in_progress" && task.status !== "completed") return null;
  return { id: task.id, content: task.content, activeForm: task.activeForm, status: task.status };
}

export function projectTasks(displayState: AgentControllerDisplayState, fallback: WorkbenchTask[] = []): WorkbenchTask[] {
  const tasks = displayState.tasks.map(taskFromMastra).filter((task): task is WorkbenchTask => task !== null);
  return tasks.length > 0 ? tasks : fallback;
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

export function parseSuspendedInteraction(input: SuspendedToolLike, version: number, originMessageId?: string): PendingInteraction | null {
  const payload = input.suspendPayload && typeof input.suspendPayload === "object" ? input.suspendPayload as Record<string, unknown> : {};
  if (input.toolName === "ask_user") {
    const options = Array.isArray(payload.options)
      ? payload.options.map((option) => {
        if (!option || typeof option !== "object" || typeof (option as { label?: unknown }).label !== "string") return null;
        const record = option as { label: string; description?: unknown };
        return { label: record.label, ...(typeof record.description === "string" ? { description: record.description } : {}) };
      }).filter((value): value is { label: string; description?: string } => value !== null)
      : [];
    return {
      id: input.toolCallId,
      toolCallId: input.toolCallId,
      kind: "ask_user",
      title: "PROTEUS has a question",
      question: typeof payload.question === "string" ? payload.question : "What would you like PROTEUS to do next?",
      options,
      selectionMode: payload.selectionMode === "multi_select" ? "multi_select" : options.length > 0 ? "single_select" : undefined,
      status: "pending",
      ...(originMessageId ? { originMessageId } : {}),
      createdAt: new Date().toISOString(),
    };
  }
  if (input.toolName === "submit_plan") {
    const parsed = parsePlanText(typeof payload.plan === "string" ? payload.plan : undefined);
    return {
      id: input.toolCallId,
      toolCallId: input.toolCallId,
      kind: "submit_plan",
      title: typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : parsed.title,
      options: [],
      plan: { version, ...parsed, ...(typeof payload.path === "string" ? { sourcePath: payload.path } : {}), status: "draft" },
      status: "pending",
      ...(originMessageId ? { originMessageId } : {}),
      createdAt: new Date().toISOString(),
    };
  }
  return null;
}

/**
 * Upsert one native suspension without letting repeated display snapshots reset
 * local response progress or allocate another logical plan version.
 */
export function upsertPendingInteraction(existing: PendingInteraction[], incoming: PendingInteraction): PendingInteraction[] {
  const previous = existing.find((item) => item.toolCallId === incoming.toolCallId);
  if (!previous) return [...existing, incoming];
  const merged: PendingInteraction = {
    ...incoming,
    status: previous.status,
    createdAt: previous.createdAt,
    ...(previous.originMessageId ? { originMessageId: previous.originMessageId } : {}),
    ...(previous.error ? { error: previous.error } : {}),
    ...(incoming.plan
      ? {
          plan: {
            ...previous.plan,
            ...incoming.plan,
            version: previous.plan?.version ?? incoming.plan.version,
            status: previous.plan?.status ?? incoming.plan.status,
          },
        }
      : {}),
  };
  return existing.map((item) => (item.toolCallId === incoming.toolCallId ? merged : item));
}

export function projectPendingInteractions(
  displayState: AgentControllerDisplayState,
  existing: PendingInteraction[],
  firstPlanVersion: number,
): PendingInteraction[] {
  const live = new Map<string, SuspendedToolLike>();
  for (const [toolCallId, suspension] of displayState.pendingSuspensions.entries()) {
    live.set(toolCallId, { toolCallId, toolName: suspension.toolName, suspendPayload: suspension.suspendPayload });
  }

  // A freshly emitted `tool_suspended` event can arrive before Mastra's
  // synthetic display-state event updates `pendingSuspensions`. Keep pending
  // interactions until an explicit response/cancel path removes them; a
  // transiently incomplete display-state snapshot must not send the UI back to
  // a generic "Thinking" state.
  const next = existing.filter((item) => item.status === "pending" || item.status === "resolving" || item.status === "failed" || live.has(item.toolCallId));
  let version = firstPlanVersion;
  for (const suspension of live.values()) {
    const parsed = parseSuspendedInteraction(suspension, version);
    if (!parsed) continue;
    if (parsed.kind === "submit_plan") version += 1;
    const merged = upsertPendingInteraction(next, parsed);
    next.splice(0, next.length, ...merged);
  }
  return next;
}

export function upsertChatMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index < 0) return [...messages, message];
  const next = [...messages];
  next[index] = message;
  return next;
}

export type LiveAssistantProjection = {
  runId: string;
  threadId: string;
  /** Durable user-signal ID that owns this assistant turn. */
  turnId: string;
  runStartedAt: string;
  baselineAssistantIds: ReadonlySet<string>;
  /** A tool suspension can create multiple Mastra assistant message IDs. */
  messages: Map<string, ChatMessage>;
  messageOrder: string[];
  outcome: ChatMessage["status"] | null;
};

function normalizedAssistantText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function projectionMessages(projection: LiveAssistantProjection): ChatMessage[] {
  return projection.messageOrder.flatMap((id) => {
    const message = projection.messages.get(id);
    return message ? [message] : [];
  });
}

function persistedAssistantsForTurn(
  messages: readonly ChatMessage[],
  projection: LiveAssistantProjection,
): ChatMessage[] {
  const turnIndex = messages.findIndex((message) => message.id === projection.turnId);
  if (turnIndex < 0) return [];

  const candidates: ChatMessage[] = [];
  for (let index = turnIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "user") break;
    if (message.role === "assistant" && !projection.baselineAssistantIds.has(message.id)) candidates.push(message);
  }
  return candidates;
}

/**
 * Reconcile one streamed assistant projection with the canonical persisted
 * history. Mastra's controller and memory store can assign different IDs to
 * the same response, so ID-only upserts are not sufficient at run completion.
 */
export function reconcileLiveAssistantTurn(
  messages: ChatMessage[],
  projection: LiveAssistantProjection,
  reconcilePersisted: boolean,
): { messages: ChatMessage[]; settled: boolean; persistedId?: string } {
  const liveMessages = projectionMessages(projection);
  if (liveMessages.length === 0) return { messages, settled: false };

  const liveIds = new Set(liveMessages.map((message) => message.id));
  const withoutLive = messages.filter((message) => !liveIds.has(message.id));
  const persisted = persistedAssistantsForTurn(withoutLive, projection);
  const persistedTerminal = persisted.at(-1);
  const terminal = liveMessages.at(-1);
  if (
    reconcilePersisted &&
    projection.outcome === "complete" &&
    persistedTerminal &&
    terminal &&
    normalizedAssistantText(persistedTerminal.text) === normalizedAssistantText(terminal.text)
  ) {
    return { messages: withoutLive, settled: true, persistedId: persistedTerminal.id };
  }

  // The local turn is authoritative until canonical storage contains its final
  // response. Suppress a partial canonical row for this exact user turn so a
  // suspended/resumed response cannot render twice.
  const persistedIds = new Set(persisted.map((message) => message.id));
  const withoutPartialCanonical = persistedIds.size > 0
    ? withoutLive.filter((message) => !persistedIds.has(message.id))
    : withoutLive;
  return {
    messages: liveMessages.reduce(upsertChatMessage, withoutPartialCanonical),
    settled: false,
  };
}
