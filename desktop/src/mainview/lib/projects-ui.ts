import type { ThreadSummary } from "../../shared/contracts";

export function projectThreadsFor(threads: ThreadSummary[], projectId: string): ThreadSummary[] {
  return threads
    .filter((thread) => thread.workspace.binding.kind === "project" && thread.workspace.binding.projectId === projectId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function chatCountLabel(count: number): string {
  return `${count} ${count === 1 ? "chat" : "chats"}`;
}

/** The DS `dot` class for a thread's activity: run while working, warn when it needs the person. */
export function activityDotClass(activity: ThreadSummary["activity"]): string {
  switch (activity) {
    case "running": return "dot run";
    case "waiting": return "dot warn";
    case "error": return "dot err";
    case "complete": return "dot ok";
    default: return "dot";
  }
}
