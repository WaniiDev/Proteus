import type { ChatMessage, ChatMessagePart, ChatToolPart } from "../../shared/contracts";
import { toolResultError } from "../tools/tool-result-error";
import { extractSafeErrorMessage } from "../core/error-message";
import { answerConfirmed, answerPart, answerRejected, projectAnswerInput, projectAnswerText, SHOW_ANSWER_NAME } from "./answer-stream";

export type NativeAgentChunk = {
  type: string;
  runId?: string;
  payload?: Record<string, unknown>;
};

export type NativeStreamProjection = {
  runId: string;
  threadId: string;
  message: ChatMessage;
  terminal: "complete" | "interrupted" | "error" | null;
  terminalError?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens?: number };
};

function labelForTool(name: string): string {
  return name.replace(/^mastra_workspace_/, "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function usageFrom(payload: Record<string, unknown> | undefined): NativeStreamProjection["usage"] {
  const output = payload?.output as { usage?: Record<string, unknown> } | undefined;
  const total = (payload?.totalUsage ?? output?.usage) as Record<string, unknown> | undefined;
  if (!total) return undefined;
  const promptTokens = Number(total.inputTokens ?? total.promptTokens ?? 0);
  const completionTokens = Number(total.outputTokens ?? total.completionTokens ?? 0);
  const reasoningTokens = Number(total.reasoningTokens ?? 0);
  return {
    promptTokens,
    completionTokens,
    totalTokens: Number(total.totalTokens ?? promptTokens + completionTokens),
    ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
  };
}

export class NativeStreamProjector {
  private readonly turns = new Map<string, NativeStreamProjection>();
  /** Raw streamed `show_answer` input text per run and tool call. */
  private readonly answerInput = new Map<string, string>();

  apply(threadId: string, chunk: NativeAgentChunk): NativeStreamProjection | null {
    const runId = chunk.runId;
    if (!runId) return null;
    const current = this.turns.get(runId) ?? this.create(runId, threadId);
    const payload = chunk.payload ?? {};
    let parts = [...current.message.parts];
    let terminal = current.terminal;
    let usage = current.usage;

    if (chunk.type === "text-delta") {
      const delta = typeof payload.text === "string" ? payload.text : "";
      const id = typeof payload.id === "string" ? payload.id : `${runId}:text`;
      const index = parts.findIndex((part) => part.type === "text" && part.id === id);
      const part = { type: "text" as const, id, text: `${index >= 0 && parts[index]?.type === "text" ? parts[index].text : ""}${delta}` };
      if (index >= 0) parts[index] = part;
      else parts.push(part);
    }

    if (chunk.type === "source-url" && typeof payload.sourceId === "string" && typeof payload.url === "string") {
      const index = parts.findIndex((part) => part.type === "source-url" && part.url === payload.url);
      const source = {
        type: "source-url" as const,
        id: `${runId}:source:${payload.sourceId}`,
        sourceId: payload.sourceId,
        url: payload.url,
        ...(typeof payload.title === "string" ? { title: payload.title } : {}),
      };
      if (index >= 0) parts[index] = source;
      else parts.push(source);
    }

    const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : undefined;
    const toolName = typeof payload.toolName === "string" ? payload.toolName : undefined;
    // show_answer streams as an answer item: only complete, valid blocks reach the snapshot (ADR 0003).
    const answerIndex = toolCallId ? parts.findIndex((part) => part.type === "answer" && part.toolCallId === toolCallId) : -1;
    const isAnswerCall = toolName === SHOW_ANSWER_NAME || answerIndex >= 0;
    let answerHandled = false;
    if (toolCallId && isAnswerCall) {
      const key = `${runId}:${toolCallId}`;
      const id = `${runId}:answer:${toolCallId}`;
      const write = (part: ChatMessagePart) => {
        if (answerIndex >= 0) parts[answerIndex] = part;
        else parts.push(part);
      };
      const rejected = chunk.type === "tool-result" ? answerRejected(payload.result) || toolResultError(payload.result) !== undefined : false;
      if (chunk.type === "tool-call-input-streaming-start") {
        this.answerInput.set(key, "");
        if (answerIndex < 0) write(answerPart({ id, toolCallId, projection: { title: "", blocks: [] }, streaming: true }));
        answerHandled = true;
      } else if (chunk.type === "tool-call-delta") {
        const text = `${this.answerInput.get(key) ?? ""}${typeof payload.argsTextDelta === "string" ? payload.argsTextDelta : ""}`;
        this.answerInput.set(key, text);
        write(answerPart({ id, toolCallId, projection: projectAnswerText(text), streaming: true }));
        answerHandled = true;
      } else if (chunk.type === "tool-call") {
        this.answerInput.delete(key);
        write(answerPart({ id, toolCallId, projection: projectAnswerInput(payload.args), streaming: false }));
        answerHandled = true;
      } else if (["tool-result", "tool-error"].includes(chunk.type) && (chunk.type === "tool-error" || rejected || payload.isError === true)) {
        // Rejected composition or failed call: the person sees neither the answer nor a tool step; the retry streams a new answer.
        this.answerInput.delete(key);
        if (answerIndex >= 0) parts.splice(answerIndex, 1);
      } else if (chunk.type === "tool-result" && answerIndex >= 0 && answerConfirmed(payload.result)) {
        const current = parts[answerIndex];
        if (current?.type === "answer") parts[answerIndex] = { ...current, confirmed: true };
      }
      // show_answer is never a tool step: the answer part is its only projection.
      answerHandled = true;
    }
    if (!answerHandled && toolCallId && toolName && ["tool-call-input-streaming-start", "tool-call", "tool-result", "tool-error", "tool-call-approval", "tool-call-suspended"].includes(chunk.type)) {
      const index = parts.findIndex((part) => part.type === "tool" && part.toolCallId === toolCallId);
      const prior = index >= 0 && parts[index]?.type === "tool" ? parts[index] as ChatToolPart : undefined;
      const resultError = chunk.type === "tool-result" ? toolResultError(payload.result) : undefined;
      const next: ChatToolPart = {
        type: "tool",
        id: prior?.id ?? `${runId}:tool:${toolCallId}`,
        toolCallId,
        name: toolName,
        label: prior?.label ?? labelForTool(toolName),
        status: chunk.type === "tool-call-input-streaming-start" ? "streaming_input" : chunk.type === "tool-call" ? "running" : chunk.type === "tool-call-approval" || chunk.type === "tool-call-suspended" ? "waiting" : chunk.type === "tool-error" || payload.isError === true || resultError ? "error" : "completed",
        ...(payload.args === undefined ? (prior?.input === undefined ? {} : { input: prior.input }) : { input: payload.args }),
        ...(chunk.type === "tool-result" ? { output: payload.result } : prior?.output === undefined ? {} : { output: prior.output }),
        ...(chunk.type === "tool-error" ? { error: extractSafeErrorMessage(payload.error) } : resultError ? { error: resultError } : {}),
      };
      if (index >= 0) parts[index] = next;
      else parts.push(next);
    }

    if (["finish", "abort", "error"].includes(chunk.type)) {
      parts = parts.map((part) => (part.type === "answer" && part.streaming ? { ...part, streaming: false } : part));
      for (const key of [...this.answerInput.keys()]) if (key.startsWith(`${runId}:`)) this.answerInput.delete(key);
    }

    if (chunk.type === "finish") {
      terminal = "complete";
      usage = usageFrom(payload) ?? usage;
    } else if (chunk.type === "abort") terminal = "interrupted";
    else if (chunk.type === "error") terminal = "error";

    const text = parts.filter((part): part is Extract<ChatMessagePart, { type: "text" }> => part.type === "text").map((part) => part.text).join("\n\n");
    const next: NativeStreamProjection = {
      ...current,
      message: { ...current.message, parts, text, status: terminal ?? "streaming" },
      terminal,
      ...(chunk.type === "error" ? { terminalError: extractSafeErrorMessage(payload.error) } : current.terminalError ? { terminalError: current.terminalError } : {}),
      ...(usage ? { usage } : {}),
    };
    this.turns.set(runId, next);
    return next;
  }

  delete(runId: string): void {
    for (const key of [...this.answerInput.keys()]) if (key.startsWith(`${runId}:`)) this.answerInput.delete(key);
    this.turns.delete(runId);
  }

  private create(runId: string, threadId: string): NativeStreamProjection {
    return {
      runId,
      threadId,
      terminal: null,
      message: {
        id: `native:${runId}`,
        role: "assistant",
        text: "",
        status: "streaming",
        createdAt: new Date().toISOString(),
        turnId: runId,
        parts: [],
      },
    };
  }
}
