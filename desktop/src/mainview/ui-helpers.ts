import type { ChatMessage, ChatMessagePart, ChatToolPart, ThreadSummary, WorkbenchState } from "../shared/contracts";

type ChatTextPart = Extract<ChatMessagePart, { type: "text" }>;

export type AssistantPartRun =
  | { type: "text"; part: ChatTextPart }
  | { type: "tools"; tools: ChatToolPart[] };

export type ConversationItem =
  | { type: "user"; message: ChatMessage }
  | {
      type: "assistant";
      id: string;
      messages: ChatMessage[];
      parts: ChatMessagePart[];
    };

export function groupAssistantPartRuns(parts: ChatMessagePart[]): AssistantPartRun[] {
  const runs: AssistantPartRun[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      runs.push({ type: "text", part });
      continue;
    }
    const previous = runs.at(-1);
    if (previous?.type === "tools") previous.tools.push(part);
    else runs.push({ type: "tools", tools: [part] });
  }
  return runs;
}

export function groupConversationItems(messages: ChatMessage[]): ConversationItem[] {
  const items: ConversationItem[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      items.push({ type: "user", message });
      continue;
    }
    const previous = items.at(-1);
    const group =
      previous?.type === "assistant" && previous.id === message.turnId
        ? previous
        : {
            type: "assistant" as const,
            id: message.turnId,
            messages: [],
            parts: [],
          };
    if (group !== previous) items.push(group);
    group.messages.push(message);
    for (const part of message.parts) {
      if (part.type === "text") {
        group.parts.push(part);
        continue;
      }
      const index = group.parts.findIndex((item) => item.type === "tool" && item.toolCallId === part.toolCallId);
      if (index >= 0) group.parts[index] = part;
      else group.parts.push(part);
    }
  }
  return items;
}

export const CONVERSATION_GROUPS = ["Today", "Previous 7 days", "Older"] as const;
export type ConversationGroupName = (typeof CONVERSATION_GROUPS)[number];

export type ConversationGroup = {
  name: ConversationGroupName;
  threads: ThreadSummary[];
};

function startOfToday(now: Date): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function conversationGroupForDate(value: string, now = new Date()): ConversationGroupName {
  const timestamp = new Date(value).getTime();
  const today = startOfToday(now);
  if (!Number.isFinite(timestamp) || timestamp >= today) return "Today";
  if (timestamp >= today - 7 * 24 * 60 * 60 * 1000) return "Previous 7 days";
  return "Older";
}

export function groupThreads(threads: ThreadSummary[], query = "", now = new Date()): ConversationGroup[] {
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = threads
    .filter((thread) => !normalized || thread.title.toLocaleLowerCase().includes(normalized))
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return CONVERSATION_GROUPS.map((name) => ({
    name,
    threads: filtered.filter((thread) => conversationGroupForDate(thread.updatedAt, now) === name),
  })).filter((group) => group.threads.length > 0);
}

export function relativeTime(value: string, now = new Date()): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.floor((now.getTime() - timestamp) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 60 * 60) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 24 * 60 * 60) return `${Math.floor(seconds / (60 * 60))}h`;
  if (seconds < 7 * 24 * 60 * 60) return `${Math.floor(seconds / (24 * 60 * 60))}d`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function goalFromMessages(messages: ChatMessage[], fallback = "Current work"): string {
  const userMessage = [...messages].reverse().find((message) => message.role === "user" && message.text.trim());
  const text = userMessage?.text.replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > 88 ? `${text.slice(0, 85).trimEnd()}…` : text;
}

export function shouldShowWorkbench(workbench: WorkbenchState): boolean {
  const hasPendingAttention = workbench.pendingInteractions.some((item) => item.status === "pending" || item.status === "resolving");
  const hasIncompleteTask = workbench.tasks.some((task) => task.status !== "completed");
  const hasQueue = workbench.queuedFollowUpCount > 0;
  const hasUsage = workbench.tokenUsage.totalTokens > 0;
  return hasPendingAttention || hasIncompleteTask || hasQueue || hasUsage || workbench.status === "waiting" || workbench.status === "complete" || workbench.status === "interrupted" || workbench.status === "error";
}
