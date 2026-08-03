import type { ChatMessage, ThreadSummary, WorkbenchState } from "../shared/contracts";

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
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
  const hasQueue = workbench.queuedFollowUps.length > 0 || workbench.clearedFollowUps.length > 0;
  const hasUsage = workbench.tokenUsage.totalTokens > 0;
  return hasPendingAttention || hasIncompleteTask || workbench.activeTools.length > 0 || hasQueue || hasUsage || workbench.status === "waiting" || workbench.status === "complete" || workbench.status === "interrupted" || workbench.status === "error";
}
