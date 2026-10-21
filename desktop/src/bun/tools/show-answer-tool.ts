import { createTool } from "@mastra/core/tools";
import { answerInputSchema, answerShapeSchema, checkAnswer, compositionIssues, repairComposition } from "../../shared/answer-catalog";

export const SHOW_ANSWER_TOOL_ID = "show_answer";

export type ShowAnswerResult =
  | { ok: true; shown: true }
  | { ok: false; shown: false; retry: boolean; message: string };

export const RUN_ID_CONTEXT_KEY = "proteus-run-id";

type ToolContext = { agent?: { threadId?: string; messages?: Array<{ role?: unknown }> }; requestContext?: { get?: (key: string) => unknown } } | undefined;

/**
 * Failures are counted per turn, keyed by the run id the runtime puts in the request context when a run starts, so a
 * failure in one turn never costs the retry in the next. The conversation window (memory lastMessages) plateaus, so
 * counting user messages is only the fallback for a caller that supplies no run id.
 */
function turnKey(context: ToolContext): string {
  const agent = context?.agent;
  const runId = context?.requestContext?.get?.(RUN_ID_CONTEXT_KEY);
  if (typeof runId === "string" && runId) return `${agent?.threadId ?? "default"}:run:${runId}`;
  const userMessages = Array.isArray(agent?.messages) ? agent.messages.filter((message) => message?.role === "user").length : 0;
  return `${agent?.threadId ?? "default"}:${userMessages}`;
}

type JsonNode = Record<string, unknown>;

/**
 * Rewrites the catalog's JSON Schema into the subset every provider accepts: tuples (`items` or `prefixItems` arrays,
 * which OpenAI rejects) become an array of any of their members, and `oneOf` becomes `anyOf`. `execute` still checks
 * every block against the catalog itself, so this only changes how the rules are written for the model.
 */
function forProviders(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(forProviders);
  if (!node || typeof node !== "object") return node;
  const { oneOf, items, prefixItems, additionalItems: _additionalItems, ...rest } = node as JsonNode;
  const out: JsonNode = Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, forProviders(value)]));
  const tuple = Array.isArray(prefixItems) ? prefixItems : Array.isArray(items) ? items : undefined;
  if (tuple) out.items = { anyOf: forProviders(tuple) };
  else if (items !== undefined) out.items = forProviders(items);
  if (oneOf !== undefined) out.anyOf = forProviders(oneOf);
  return out;
}

/**
 * The model sees the whole catalog (every block's fields, types and limits) as the tool's JSON Schema, so it can write
 * valid blocks. Validation stays structural (`answerInputSchema`): `execute` receives the raw blocks and checks them
 * itself, so a bad block costs one retry or a fallback line instead of failing input validation.
 */
const catalog = answerShapeSchema["~standard"];
const structural = answerInputSchema["~standard"];
export const showAnswerInputSchema: { "~standard": typeof structural } = {
  "~standard": {
    version: 1,
    vendor: "proteus",
    validate: structural.validate,
    jsonSchema: {
      input: (options) => forProviders(catalog.jsonSchema.input(options)) as JsonNode,
      output: (options) => forProviders(catalog.jsonSchema.output(options)) as JsonNode,
    },
  },
};

/**
 * `show_answer` renders a catalog v2 answer in the Island (ADR 0003). The tool only acknowledges: the UI reads the
 * streamed input. The first failed attempt in a turn returns a normal result the model reads to retry, naming each
 * broken block and composition rule. On the retry the answer stands: a block that still breaks its own limits is shown
 * as a fallback line and a composition failure is repaired (`repairComposition`). Only an answer with no usable block or
 * a broken envelope (version, title) tells the model to answer in prose. The person never sees a rejected answer.
 */
export function createShowAnswerTool() {
  const failures = new Map<string, number>();
  return createTool({
    id: SHOW_ANSWER_TOOL_ID,
    description: "Show the reply as an answer made of blocks (v: 2, a title, then 1-10 blocks: headline first and once, then text, stats, list, timeline, progress, table, bars, choice, diff, quote; sources then suggest last). Use it when the reply is a set of things to act on, a comparison, a plan, numbers or a trend; answer in prose otherwise. Plain text only: no markup, HTML, Markdown or links.",
    inputSchema: showAnswerInputSchema,
    execute: async (input, context): Promise<ShowAnswerResult> => {
      const key = turnKey(context as ToolContext);
      const { blocks, issues, blockIssues, envelopeIssues } = checkAnswer(input);
      const attempts = (failures.get(key) ?? 0) + 1;
      // On the retry the answer stands once it is repaired: what the person sees is the repaired composition.
      const title = (input as { title?: unknown }).title;
      const repairable = attempts > 1 && envelopeIssues.length === 0
        && compositionIssues(repairComposition(blocks, typeof title === "string" ? title : "")).length === 0
        && blocks.some((block) => block.type !== "fallback");
      if ((issues.length === 0 && blockIssues.length === 0) || repairable) {
        failures.delete(key);
        return { ok: true, shown: true };
      }
      const reasons = [...issues, ...blockIssues].join(" ");
      if (attempts === 1) {
        failures.set(key, attempts);
        return { ok: false, shown: false, retry: true, message: `The answer was not shown. Fix it and call show_answer once more: ${reasons}` };
      }
      failures.delete(key);
      return { ok: false, shown: false, retry: false, message: `The answer was not shown again. Do not call show_answer again; answer in prose instead: ${reasons}` };
    },
  });
}
