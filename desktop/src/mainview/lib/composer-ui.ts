import type { ChatMessage, ChatToolPart, OrbState, PendingInteraction, RuntimeSnapshot } from "../../shared/contracts";
import { ORB_STATES } from "../orb/orb-spec";
import { askQueue, askWhat } from "./ask-copy";
import { describeToolActivity } from "./tool-activity";

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

export function canChooseComposerWorkspace(snapshot: RuntimeSnapshot, queuedDraftCount: number): boolean {
  return snapshot.activeThreadId !== null
    && snapshot.messages.length === 0
    && snapshot.activeRun === null
    && snapshot.interactions.length === 0
    && snapshot.workbench.queuedFollowUpCount === 0
    && queuedDraftCount === 0;
}

export function composerModelLabel(snapshot: RuntimeSnapshot): string {
  const model = snapshot.models.find((candidate) => candidate.id === snapshot.selectedModelId);
  const provider = snapshot.providers.find((candidate) => candidate.id === (model?.providerId ?? snapshot.selectedProviderId));
  const segments = [provider?.name, model?.name ?? snapshot.selectedModelId, snapshot.selectedReasoningEffort].filter(Boolean);
  return segments.join(" · ");
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

export type IslandMode = "input" | "status" | "ask" | "answer";
export type IslandEnd = "send" | "stop";
export type IslandStatus = { label: string; line: string };

export type IslandView = {
  mode: IslandMode;
  end: IslandEnd;
  sendLabel: string;
  sendDisabled: boolean;
  placeholder: string;
  inputDisabled: boolean;
  status: IslandStatus;
  askKind: string;
  answerLabel: string;
  answerLine: string;
};

export function openAsks(snapshot: RuntimeSnapshot): PendingInteraction[] {
  return askQueue(snapshot.interactions, snapshot.activeThreadId);
}

/** The kicker's subject, with the place in the queue once there is more than one: "Edit file · 1 of 3". */
export function askKickerSubject(asks: PendingInteraction[]): string {
  if (!asks[0]) return "";
  return asks.length > 1 ? `${askWhat(asks[0])} · 1 of ${asks.length}` : askWhat(asks[0]);
}

const NEUTRAL_ORB_STATES = new Set<OrbState>(["idle", "away", "done", "interrupted", "error", "recovery"]);

/** The live status line: the orb state's word in bold, the step in progress after it. */
export function islandStatus(snapshot: RuntimeSnapshot, orbState: OrbState, queuedDraftCount = 0): IslandStatus {
  const label = NEUTRAL_ORB_STATES.has(orbState) ? "Working" : ORB_STATES[orbState].label;
  const tools = snapshot.messages.flatMap((message) => message.parts).filter((part): part is ChatToolPart => part.type === "tool" && (part.status === "running" || part.status === "streaming_input"));
  const activeTool = tools[tools.length - 1];
  let line = "Thinking…";
  if (activeTool) line = describeToolActivity(activeTool, { tasks: snapshot.workbench.tasks }).title;
  else if (snapshot.messages.some((message) => message.status === "streaming")) line = "Writing the answer…";
  const queued = Math.max(snapshot.workbench.queuedFollowUpCount, queuedDraftCount);
  return { label, line: queued > 0 ? `${line} · ${queued} queued` : line };
}

export function islandPlaceholder(snapshot: RuntimeSnapshot, canChat: boolean, runningElsewhere: boolean, providerName: string): string {
  if (runningElsewhere) return "Another conversation is running…";
  if (!canChat) return `Configure ${providerName} in Settings to chat`;
  return snapshot.messages.length === 0 && snapshot.activeRun === null ? "Ask Proteus anything" : "Ask a follow-up…";
}

/** Which Island variants are on. Every variant stays mounted; this only says which one is visible. */
export function deriveIsland(args: { snapshot: RuntimeSnapshot; orbState: OrbState; input: string; canChat: boolean; runningForSelected: boolean; runningElsewhere: boolean; providerName: string; queuedDraftCount: number; answer?: { streaming: boolean; question: string } | null }): IslandView {
  const { snapshot, orbState, input, canChat, runningForSelected, runningElsewhere, providerName, queuedDraftCount, answer = null } = args;
  const hasDraft = input.trim().length > 0;
  const action = composerAction(runningForSelected, hasDraft);
  const asks = openAsks(snapshot);
  const mode: IslandMode = asks.length > 0 ? "ask" : answer ? "answer" : action === "stop" ? "status" : "input";
  return {
    mode,
    end: action === "stop" ? "stop" : "send",
    sendLabel: action === "queue" ? "Queue message" : "Send",
    sendDisabled: !canChat || !hasDraft,
    placeholder: islandPlaceholder(snapshot, canChat, runningElsewhere, providerName),
    inputDisabled: !canChat,
    status: islandStatus(snapshot, orbState, queuedDraftCount),
    askKind: askKickerSubject(asks),
    answerLabel: answer?.streaming ? "Speaking" : "Answer",
    answerLine: answer?.question ?? "",
  };
}
