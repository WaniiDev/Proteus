import { toAISdkV5Messages } from "@mastra/ai-sdk/ui";
import type { ChatMessage, ChatMessagePart } from "../../shared/contracts";
import { applyToolOutcomes, historicalTaskToolOutcomes, normalizeLegacyTaskToolArtifacts, projectedMessageId, upsertChatMessage, reconcileLiveAssistantTurn, type LiveAssistantProjection, type ProjectedToolOutcome } from "../core/runtime-projection";
import { chatRole, extractText, isoDate, projectMessageParts, sanitizeToolDetail } from "./message-mapping";
import type { MastraMessage } from "./types";
import type { RuntimeContext } from "./context";

/** Maps Mastra messages into chat messages and merges optimistic and live-streamed ones. */
export class MessageProjector {

  constructor(private readonly ctx: RuntimeContext) {

  }

  recordPersistedAssistantIds(threadId: string, rawMessages: MastraMessage[]): void {
    this.ctx.persistedAssistantIds.set(threadId, new Set(rawMessages.filter((message) => message.role === "assistant").map((message) => message.id)));
  }

  private assistantProjectionsForThread(threadId: string): LiveAssistantProjection[] {
    return [...this.ctx.assistantProjections.values()].filter((projection) => projection.threadId === threadId && projection.messages.size > 0).sort((left, right) => left.runStartedAt.localeCompare(right.runStartedAt));
  }

  mapMessages(rawMessages: MastraMessage[], persistedOutcomes?: Record<string, ProjectedToolOutcome>): ChatMessage[] {
    const retryMatches = this.ctx.retryingText ? rawMessages.map((message, index) => (chatRole(message) === "user" && extractText(message) === this.ctx.retryingText ? index : -1)).filter((index) => index >= 0) : [];
    const hiddenRetryIndex = retryMatches.length >= 2 || (this.ctx.hideSingleRetry && retryMatches.length >= 1) ? retryMatches[retryMatches.length - 1] : -1;
    const hiddenRetryId = hiddenRetryIndex >= 0 ? rawMessages[hiddenRetryIndex]?.id : undefined;
    const sourceById = new Map(rawMessages.map((message) => [message.id, message]));
    const converted = toAISdkV5Messages(rawMessages as Parameters<typeof toAISdkV5Messages>[0]);
    let currentTurnId = "conversation-start";
    let lastQuestion = "";
    const projected = converted
      .map((message) => {
        const role = message.role === "user" || message.role === "assistant" || message.role === "system" ? message.role : null;
        const source = sourceById.get(message.id);
        const projectedId = projectedMessageId(source ?? { id: message.id, role: message.role }, role ?? "unknown");
        if (role === "user") currentTurnId = projectedId;
        return { message, source, role, turnId: currentTurnId, projectedId };
      })
      .filter(
        (entry): entry is {
          message: (typeof converted)[number];
          source: MastraMessage | undefined;
          role: ChatMessage["role"];
          turnId: string;
          projectedId: string;
        } => entry.role !== null && entry.message.id !== hiddenRetryId,
      )
      .map(({ message, source, role, turnId, projectedId }) => {
        let parts = projectMessageParts({
          id: projectedId,
          role,
          createdAt: source?.createdAt ?? new Date(),
          content: { format: 2, parts: message.parts },
        } as MastraMessage);
        const text = parts
          .filter((part): part is Extract<ChatMessagePart, { type: "text" }> => part.type === "text")
          .map((part) => part.text)
          .join("\n\n");
        if (role === "user") lastQuestion = text;
        else parts = parts.map((part) => (part.type === "answer" ? { ...part, question: lastQuestion } : part));
        return {
          id: projectedId,
          role,
          text,
          turnId,
          parts,
          status: (role === "assistant" && message.id === this.ctx.lastAssistantId && this.ctx.runOutcome === "streaming" ? "streaming" : role === "assistant" && message.id === this.ctx.lastAssistantId && this.ctx.runOutcome === "interrupted" ? "interrupted" : role === "assistant" && message.id === this.ctx.lastAssistantId && this.ctx.runOutcome === "error" ? "error" : "complete") as ChatMessage["status"],
          createdAt: isoDate(source?.createdAt ?? new Date()),
          retryable: role === "assistant" && message.id === this.ctx.lastAssistantId ? this.ctx.runError?.retryable : undefined,
        };
      })
      .filter((message) => message.parts.length > 0);
    const outcomes = historicalTaskToolOutcomes(rawMessages);
    for (const [toolCallId, outcome] of Object.entries(persistedOutcomes ?? {})) outcomes.set(toolCallId, outcome);
    for (const [toolCallId, outcome] of this.ctx.runToolOutcomes) outcomes.set(toolCallId, outcome);
    return normalizeLegacyTaskToolArtifacts(applyToolOutcomes(projected, outcomes));
  }

  mergeTransientMessages(threadId: string, messages: ChatMessage[], reconcilePersisted = false): ChatMessage[] {
    let next = messages;
    for (const [id, optimistic] of this.ctx.optimisticUserMessages) {
      if (optimistic.threadId !== threadId) continue;
      const persisted = reconcilePersisted && next.some((message) => message.id === id);
      if (persisted) this.ctx.optimisticUserMessages.delete(id);
      else next = upsertChatMessage(next, optimistic.message);
    }

    const projections = this.assistantProjectionsForThread(threadId);
    for (const projection of projections) {
      const result = reconcileLiveAssistantTurn(next, projection, reconcilePersisted);
      next = result.messages;
      if (reconcilePersisted && result.settled) {
        this.ctx.assistantProjections.delete(projection.runId);
        if (result.persistedId) this.ctx.lastAssistantId = result.persistedId;
      }
    }
    return next;
  }

  recordToolOutcome(toolCallId: string, result: unknown, isError: boolean, status?: ProjectedToolOutcome["status"]): void {
    const safeOutput = result === undefined ? undefined : sanitizeToolDetail(result);
    const content = safeOutput && typeof safeOutput === "object" ? (safeOutput as { content?: unknown }).content : undefined;
    const outcome: ProjectedToolOutcome = {
      status: status ?? (isError ? "error" : "completed"),
      ...(safeOutput !== undefined ? { output: safeOutput } : {}),
      ...(isError ? { error: typeof content === "string" ? content.slice(0, 2_000) : "Tool failed." } : {}),
    };
    this.ctx.runToolOutcomes.set(toolCallId, outcome);
    const single = new Map([[toolCallId, outcome]]);
    for (const projection of this.ctx.assistantProjections.values()) {
      for (const [messageId, message] of projection.messages) projection.messages.set(messageId, applyToolOutcomes([message], single)[0]);
    }
    this.ctx.publish({ messages: applyToolOutcomes(this.ctx.snapshot.messages, single) });
  }
}
