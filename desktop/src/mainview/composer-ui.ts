import type { ChatMessage } from "../shared/contracts";

export type ComposerAction = "send" | "queue" | "stop";

export type QueuedDraft = {
  id: string;
  threadId: string;
  text: string;
  createdAt: string;
  state: "queued" | "sending";
};

export function composerAction(running: boolean, hasDraft: boolean): ComposerAction {
  if (!running) return "send";
  return hasDraft ? "queue" : "stop";
}

export function shouldSubmitComposerKey(input: { key: string; shiftKey: boolean; isComposing: boolean }): boolean {
  return input.key === "Enter" && !input.shiftKey && !input.isComposing;
}

export function composerInputHeight(scrollHeight: number, stageHeight: number): number {
  const minimumHeight = 24;
  const maximumHeight = Math.max(minimumHeight, Math.floor(stageHeight * 0.5));
  return Math.min(Math.max(scrollHeight, minimumHeight), maximumHeight);
}

export function reconcileQueuedDrafts(drafts: QueuedDraft[], messages: ChatMessage[], activeThreadId: string | null, queuedCount: number): QueuedDraft[] {
  if (!activeThreadId) return [];
  const active = drafts.filter((draft) => draft.threadId === activeThreadId).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const candidates = messages.filter((message) => message.role === "user").slice().sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const used = new Set<string>();
  const remaining = active.filter((draft) => {
    const draftTime = new Date(draft.createdAt).getTime();
    const match = candidates.find((message) => !used.has(message.id) && message.text.trim() === draft.text.trim() && new Date(message.createdAt).getTime() >= draftTime - 1_000);
    if (!match) return true;
    used.add(match.id);
    return false;
  });
  const sendingCount = Math.max(0, remaining.length - queuedCount);
  return remaining.map((draft, index) => ({ ...draft, state: index < sendingCount ? "sending" : "queued" }));
}
