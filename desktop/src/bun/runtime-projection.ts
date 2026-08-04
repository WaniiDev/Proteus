import type { AgentControllerDisplayState } from "@mastra/core/agent-controller";
import type { ChatMessage, ChatToolPart, PendingInteraction, WorkbenchTask } from "../shared/contracts";

type TaskLike = { id?: unknown; content?: unknown; activeForm?: unknown; status?: unknown };

type SuspendedToolLike = {
  toolCallId: string;
  toolName: string;
  suspendPayload: unknown;
};

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
    const previous = existing.find((item) => item.toolCallId === parsed.toolCallId);
    const index = next.findIndex((item) => item.toolCallId === parsed.toolCallId);
    const merged = previous ? { ...parsed, status: previous.status, createdAt: previous.createdAt, ...(previous.plan ? { plan: previous.plan } : {}), ...(previous.originMessageId ? { originMessageId: previous.originMessageId } : {}), ...(previous.error ? { error: previous.error } : {}) } : parsed;
    if (index >= 0) next[index] = merged;
    else next.push(merged);
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
