import { validateBlock } from "../../shared/answer-catalog";
import type { AnswerPartBlock, ChatAnswerPart } from "../../shared/contracts";
import { closedValue, entryOf, parsePartialJson, type PartialNode } from "./partial-json";

export const SHOW_ANSWER_NAME = "show_answer";

/** Block types whose rows stream one at a time, and the key holding those rows. */
const ROW_KEYS: Record<string, string> = { list: "rows", timeline: "rows", table: "rows", progress: "items" };

export type AnswerProjection = { title: string; blocks: AnswerPartBlock[] };

const FALLBACK: AnswerPartBlock = { type: "fallback" };

function checked(block: unknown): AnswerPartBlock {
  const result = validateBlock(block);
  return result.ok ? result.value : FALLBACK;
}

/** A block still arriving: only closed fields and closed rows, projected when that much is already valid. */
function partialBlock(node: PartialNode): AnswerPartBlock | undefined {
  if (node.kind !== "object") return undefined;
  const type = entryOf(node, "type");
  const rowKey = type?.kind === "string" && type.closed ? ROW_KEYS[type.value] : undefined;
  if (!rowKey) return undefined;
  const fields: Record<string, unknown> = {};
  let rows: PartialNode[] = [];
  for (const [key, value] of node.entries) {
    if (key === rowKey && value.kind === "array") rows = value.items.filter((item) => item.closed);
    else if (value.closed) fields[key] = closedValue(value);
  }
  // Rows join one at a time; a row that breaks the block is left out until the block closes (then it becomes a fallback).
  let accepted: AnswerPartBlock | undefined;
  const kept: unknown[] = [];
  for (const row of rows) {
    const result = validateBlock({ ...fields, [rowKey]: [...kept, closedValue(row)] });
    if (!result.ok) continue;
    kept.push(closedValue(row));
    accepted = result.value;
  }
  return accepted;
}

/** What the person may see of a `show_answer` input received so far (the raw streamed JSON text). */
export function projectAnswerText(text: string): AnswerProjection {
  const root = parsePartialJson(text);
  const titleNode = entryOf(root, "title");
  const title = titleNode?.kind === "string" && titleNode.closed ? titleNode.value : "";
  const blocksNode = entryOf(root, "blocks");
  const blocks: AnswerPartBlock[] = [];
  if (blocksNode?.kind === "array") {
    for (const item of blocksNode.items) {
      if (item.closed) blocks.push(checked(closedValue(item)));
      else {
        const partial = partialBlock(item);
        if (partial) blocks.push(partial);
      }
    }
  }
  return { title, blocks };
}

/** A complete `show_answer` input (tool call args, or stored history). Each block is validated on its own. */
export function projectAnswerInput(input: unknown): AnswerProjection {
  const record = input && typeof input === "object" ? (input as { title?: unknown; blocks?: unknown }) : {};
  return {
    title: typeof record.title === "string" ? record.title : "",
    blocks: Array.isArray(record.blocks) ? record.blocks.map(checked) : [],
  };
}

export function answerPart(options: { id: string; toolCallId: string; projection: AnswerProjection; streaming: boolean; question?: string; outcomes?: Record<string, string>; confirmed?: boolean }): ChatAnswerPart {
  return {
    type: "answer",
    id: options.id,
    toolCallId: options.toolCallId,
    answerId: options.toolCallId,
    title: options.projection.title,
    question: options.question ?? "",
    blocks: options.projection.blocks,
    streaming: options.streaming,
    outcomes: options.outcomes ?? {},
    ...(options.confirmed ? { confirmed: true } : {}),
  };
}

/** True when a finished `show_answer` result says the answer was shown: only then can the person act on it. */
export function answerConfirmed(result: unknown): boolean {
  return !!result && typeof result === "object" && (result as { ok?: unknown }).ok === true && (result as { shown?: unknown }).shown === true;
}

/** True when a finished `show_answer` result says the answer was not shown (the person never sees it, nor a tool step for it). */
export function answerRejected(result: unknown): boolean {
  return !!result && typeof result === "object" && (result as { ok?: unknown }).ok === false;
}
