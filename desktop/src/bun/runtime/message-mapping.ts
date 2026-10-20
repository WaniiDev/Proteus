import type { ChatAnswerPart, ChatMessage, ChatMessagePart, ChatToolPart, ThreadSummary, TokenUsage, WorkbenchState } from "../../shared/contracts";
import { answerPart, answerRejected, projectAnswerInput, SHOW_ANSWER_NAME } from "../native/answer-stream";
import { isDeclinedToolResult } from "../tools/tool-decision";
import { toolResultError } from "../tools/tool-result-error";
import { LEGACY_THREAD_METADATA_KEY, THREAD_METADATA_KEY, THREAD_PIN_METADATA_KEY } from "./constants";
import type { MastraMessage, PersistedThreadState } from "./types";

export function isoDate(value: Date | string | number | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  return new Date().toISOString();
}

export function extractText(message: MastraMessage): string {
  const content = message.content;
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : extractPartText(part)))
      .filter(Boolean)
      .join("");
  }
  if (typeof content !== "object") return "";
  const record = content as { content?: unknown; parts?: unknown };
  if (typeof record.content === "string") return record.content;
  return (Array.isArray(record.parts) ? record.parts : [])
    .map((part) => extractPartText(part))
    .filter(Boolean)
    .join("");
}

const SENSITIVE_DETAIL_KEY = /authorization|credential|token|secret|password|cookie|private.?key|api.?key/i;

export function sanitizeToolDetail(value: unknown): unknown {
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number): unknown => {
    if (depth > 4) return "[truncated: depth]";
    if (item === null || typeof item === "number" || typeof item === "boolean") return item;
    if (typeof item === "string") return item.length > 2_000 ? `${item.slice(0, 2_000)}…[truncated]` : item;
    if (typeof item === "bigint") return `${item}n`;
    if (typeof item === "undefined") return "[undefined]";
    if (typeof item === "function" || typeof item === "symbol") return `[unsupported: ${typeof item}]`;
    if (typeof item !== "object") return String(item);
    if (seen.has(item)) return "[cyclic]";
    seen.add(item);
    if (Array.isArray(item)) {
      const values = item.slice(0, 20).map((entry) => visit(entry, depth + 1));
      if (item.length > 20) values.push(`[truncated: ${item.length - 20} items]`);
      return values;
    }
    const entries = Object.entries(item as Record<string, unknown>)
      .slice(0, 40)
      .map(([key, entry]) => [key, SENSITIVE_DETAIL_KEY.test(key) ? "[redacted]" : visit(entry, depth + 1)]);
    if (Object.keys(item).length > 40) entries.push(["[truncated]", `${Object.keys(item).length - 40} keys`]);
    return Object.fromEntries(entries);
  };
  const safe = visit(value, 0);
  const json = JSON.stringify(safe);
  return json.length <= 8_192 ? safe : { preview: `${json.slice(0, 8_000)}…`, truncated: true };
}

export function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    ask_user: "Asked for input",
    submit_plan: "Submitted plan",
    task_write: "Created task list",
    task_update: "Updated task",
    task_complete: "Completed task",
    task_check: "Checked task progress",
  };
  return labels[name] ?? name.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function detailSummary(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim().slice(0, 140) || undefined;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidate = [record.summary, record.message, record.content, record.result].find((entry) => typeof entry === "string") as string | undefined;
    if (candidate) return candidate.replace(/\s+/g, " ").trim().slice(0, 140);
  }
  return undefined;
}

export function toolPart(part: unknown, messageId: string, index: number): ChatToolPart | ChatAnswerPart | null {
  if (!part || typeof part !== "object") return null;
  const record = part as Record<string, unknown>;
  let name: unknown;
  let callId: unknown;
  let input: unknown;
  let output: unknown;
  let rawStatus: unknown;
  let error: unknown;
  let approval: unknown;
  if (record.type === "tool-invocation" && record.toolInvocation && typeof record.toolInvocation === "object") {
    const invocation = record.toolInvocation as Record<string, unknown>;
    name = invocation.toolName;
    callId = invocation.toolCallId;
    input = invocation.args;
    output = invocation.result;
    rawStatus = invocation.state;
    approval = invocation.approval;
  } else if (typeof record.type === "string" && record.type.startsWith("tool-")) {
    name = record.toolName ?? record.type.slice(5);
    callId = record.toolCallId;
    input = record.input ?? record.args;
    output = record.output ?? record.result;
    rawStatus = record.state ?? record.status;
    error = record.errorText ?? record.error;
    approval = record.approval;
  } else return null;
  if (typeof name !== "string") return null;
  const statusText = String(rawStatus ?? "running").toLowerCase();
  const structuredError = toolResultError(output);
  const isError = Boolean(error) || Boolean(structuredError);
  const declined = isDeclinedToolResult({ state: rawStatus, approval, output });
  const status: ChatToolPart["status"] = declined ? "declined" : isError ? "error" : /result|output-available|complete|success/.test(statusText) ? "completed" : /approval|suspend|waiting/.test(statusText) ? "waiting" : /cancel/.test(statusText) ? "cancelled" : /partial|input-stream/.test(statusText) ? "streaming_input" : "running";
  const toolCallId = typeof callId === "string" && callId ? callId : `${messageId}:tool:${index}`;
  const rejection = name === SHOW_ANSWER_NAME ? answerRejected(output) : undefined;
  if (name === SHOW_ANSWER_NAME && !rejection && !isError && !declined && status !== "cancelled") {
    // Stored answers keep their full input (sanitizing would truncate nested rows) and rebuild the same blocks as the stream.
    return answerPart({ id: `${messageId}:answer:${toolCallId}`, toolCallId, projection: projectAnswerInput(input), streaming: status === "streaming_input" });
  }
  const safeInput = input === undefined ? undefined : sanitizeToolDetail(input);
  const safeOutput = output === undefined ? undefined : sanitizeToolDetail(output);
  return {
    type: "tool",
    id: `${messageId}:tool:${toolCallId}`,
    toolCallId,
    name,
    label: toolLabel(name),
    status: rejection ? "error" : status,
    inputSummary: detailSummary(safeInput),
    outputSummary: detailSummary(safeOutput),
    input: safeInput,
    output: safeOutput,
    error: error === undefined ? rejection ?? structuredError : String(error).slice(0, 2_000),
  };
}

export function projectMessageParts(message: MastraMessage): ChatMessagePart[] {
  const content = message.content;
  const raw = Array.isArray(content) ? content : content && typeof content === "object" && Array.isArray((content as { parts?: unknown }).parts) ? (content as { parts: unknown[] }).parts : [content];
  return raw.flatMap((part, index): ChatMessagePart[] => {
    const text = extractPartText(part);
    if (text) return [{ type: "text", id: `${message.id}:text:${index}`, text }];
    if (part && typeof part === "object" && (part as { type?: unknown }).type === "source-url") {
      const source = part as { sourceId?: unknown; url?: unknown; title?: unknown };
      if (typeof source.sourceId === "string" && source.sourceId && typeof source.url === "string") {
        return [{ type: "source-url", id: `${message.id}:source:${index}`, sourceId: source.sourceId, url: source.url, ...(typeof source.title === "string" ? { title: source.title } : {}) }];
      }
    }
    const tool = toolPart(part, message.id, index);
    return tool ? [tool] : [];
  });
}

export function extractPartText(part: unknown): string {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  const record = part as { type?: unknown; text?: unknown; content?: unknown };
  if (record.type !== undefined && record.type !== "text") return "";
  return typeof record.text === "string" ? record.text : typeof record.content === "string" ? record.content : "";
}

export function chatRole(message: MastraMessage): ChatMessage["role"] | null {
  if (message.role === "assistant") return "assistant";
  if (message.role === "user") return "user";
  if (message.role === "signal") {
    const content = message.content;
    const contentMetadata = content && typeof content === "object" && !Array.isArray(content) ? (content as { metadata?: { signal?: { type?: string } } }).metadata : undefined;
    if (contentMetadata?.signal?.type === "user" || message.metadata?.signal?.type === "user") return "user";
  }
  return null;
}

export function mapThread(thread: { id: string; title?: string | null; createdAt: Date; updatedAt: Date; metadata?: Record<string, unknown> | null }): ThreadSummary {
  const rawState = thread.metadata?.[THREAD_METADATA_KEY] ?? thread.metadata?.[LEGACY_THREAD_METADATA_KEY];
  const binding = rawState && typeof rawState === "object" && !Array.isArray(rawState) && "workspaceBinding" in rawState
    ? (rawState as PersistedThreadState).workspaceBinding ?? { kind: "app" as const }
    : { kind: "app" as const };
  const rawPin = thread.metadata?.[THREAD_PIN_METADATA_KEY];
  const pinnedAt = rawPin && typeof rawPin === "object" && typeof (rawPin as { pinnedAt?: unknown }).pinnedAt === "string"
    ? (rawPin as { pinnedAt: string }).pinnedAt
    : null;
  return {
    id: thread.id,
    title: thread.title?.trim() || "New chat",
    createdAt: isoDate(thread.createdAt),
    updatedAt: isoDate(thread.updatedAt),
    activity: "idle",
    attention: 0,
    workspace: { binding, label: binding.kind === "app" ? "Proteus workspace" : "Project", availability: "ready" },
    pinned: pinnedAt !== null,
    pinnedAt,
  };
}

/** Pinned threads first by pinnedAt descending, then the rest by updatedAt descending. */
export function compareThreads(left: ThreadSummary, right: ThreadSummary): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  if (left.pinned) return (right.pinnedAt ?? "").localeCompare(left.pinnedAt ?? "");
  return right.updatedAt.localeCompare(left.updatedAt);
}

export function emptyTokenUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

export function emptyWorkbench(): WorkbenchState {
  return {
    status: "idle",
    tasks: [],
    pendingInteractions: [],
    queuedFollowUpCount: 0,
    tokenUsage: emptyTokenUsage(),
  };
}
