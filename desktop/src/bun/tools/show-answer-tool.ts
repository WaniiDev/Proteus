import { createTool } from "@mastra/core/tools";
import { answerInputSchema, checkAnswer } from "../../shared/answer-catalog";

export const SHOW_ANSWER_TOOL_ID = "show_answer";

export type ShowAnswerResult =
  | { ok: true; shown: true }
  | { ok: false; shown: false; retry: boolean; message: string };

type ToolContext = { agent?: { threadId?: string; messages?: Array<{ role?: unknown }> } } | undefined;

/**
 * Failures are counted per turn: the thread plus how many user messages the conversation holds, so a failure in one
 * turn never costs the retry in the next.
 */
function turnKey(context: ToolContext): string {
  const agent = context?.agent;
  const userMessages = Array.isArray(agent?.messages) ? agent.messages.filter((message) => message?.role === "user").length : 0;
  return `${agent?.threadId ?? "default"}:${userMessages}`;
}

/**
 * `show_answer` renders a catalog v2 answer in the Island (ADR 0003). The tool only acknowledges: the UI reads the
 * streamed input. The input schema is structural only. Here a block that breaks its own limits is shown as a fallback
 * line (the answer stands); a composition failure (order, counts, more than 10 blocks) returns a normal result the model
 * reads, once to retry and then to answer in prose. The person never sees a rejected answer.
 */
export function createShowAnswerTool() {
  const failures = new Map<string, number>();
  return createTool({
    id: SHOW_ANSWER_TOOL_ID,
    description: "Show the reply as an answer made of blocks (v: 2, a title, then 1-10 blocks: headline first and once, then text, stats, list, timeline, progress, table, bars, choice, diff, quote; sources then suggest last). Use it when the reply is a set of things to act on, a comparison, a plan, numbers or a trend; answer in prose otherwise. Plain text only: no markup, HTML, Markdown or links.",
    inputSchema: answerInputSchema,
    execute: async (input, context): Promise<ShowAnswerResult> => {
      const key = turnKey(context as ToolContext);
      const { issues } = checkAnswer(input);
      if (issues.length === 0) {
        failures.delete(key);
        return { ok: true, shown: true };
      }
      const reasons = issues.join(" ");
      const attempts = (failures.get(key) ?? 0) + 1;
      if (attempts === 1) {
        failures.set(key, attempts);
        return { ok: false, shown: false, retry: true, message: `The answer was not shown. Fix it and call show_answer once more: ${reasons}` };
      }
      failures.delete(key);
      return { ok: false, shown: false, retry: false, message: `The answer was not shown again. Do not call show_answer again; answer in prose instead: ${reasons}` };
    },
  });
}
