import type { ChatMessage, ChatMessagePart, ChatToolPart } from "../shared/contracts";
import { toolResultError } from "./tool-result-error";
import { extractSafeErrorMessage } from "./error-message";

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
    if (toolCallId && toolName && ["tool-call-input-streaming-start", "tool-call", "tool-result", "tool-error", "tool-call-approval", "tool-call-suspended"].includes(chunk.type)) {
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
