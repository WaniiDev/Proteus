import type { ChatMessage, RuntimeSnapshot } from "../shared/contracts";

export type ComposerAction = "send" | "queue" | "stop";

export type QueuedDraft = {
  id: string;
  threadId: string;
  text: string;
  createdAt: string;
  state: "queued" | "sending";
};

export function selectedProviderCanChat(snapshot: RuntimeSnapshot): boolean {
  const model = snapshot.models.find((candidate) => candidate.id === snapshot.selectedModelId);
  const providerId = model?.providerId ?? snapshot.selectedProviderId;
  const provider = snapshot.providers.find((candidate) => candidate.id === providerId);
  if (!provider?.verified || provider.availability !== "ready") return false;
  return providerId === "codex" || snapshot.credential.verified;
}

export function composerAction(running: boolean, hasDraft: boolean): ComposerAction {
  if (!running) return "send";
  return hasDraft ? "queue" : "stop";
}

export function shouldSubmitComposerKey(input: { key: string; shiftKey: boolean; isComposing: boolean }): boolean {
  return input.key === "Enter" && !input.shiftKey && !input.isComposing;
}

export function composerLineCount(value: string): number {
  return Math.max(1, value.split(/\r\n|\r|\n/).length);
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
