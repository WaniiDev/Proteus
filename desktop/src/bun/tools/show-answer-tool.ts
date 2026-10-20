import { createTool } from "@mastra/core/tools";
import { answerShapeSchema, compositionIssues } from "../../shared/answer-catalog";

export const SHOW_ANSWER_TOOL_ID = "show_answer";

export type ShowAnswerResult =
  | { ok: true; shown: true }
  | { ok: false; shown: false; retry: true; error: string }
  | { ok: false; shown: false; retry: false; error: string };

/**
 * `show_answer` renders a catalog v2 answer in the Island (ADR 0003). The tool only acknowledges: the UI reads the
 * streamed input. Block limits are enforced by the input schema; composition rules are checked here, once the call
 * ends. A composition failure returns the error so the model can retry once; a second consecutive failure tells it
 * to answer in prose. The person never sees a rejected answer.
 */
export function createShowAnswerTool() {
  const failures = new Map<string, number>();
  return createTool({
    id: SHOW_ANSWER_TOOL_ID,
    description: "Show the reply as an answer made of blocks (headline first, then text, stats, list, timeline, progress, table, bars, choice, diff, quote; sources then suggest last). Use it when the reply is a set of things to act on, a comparison, a plan, numbers or a trend; answer in prose otherwise. Plain text only: no markup, HTML, Markdown or links.",
    inputSchema: answerShapeSchema,
    execute: async (input, context): Promise<ShowAnswerResult> => {
      const key = String((context as { agent?: { threadId?: string } } | undefined)?.agent?.threadId ?? "default");
      const issues = compositionIssues(input.blocks);
      if (issues.length === 0) {
        failures.delete(key);
        return { ok: true, shown: true };
      }
      const error = issues.join(" ");
      const attempts = (failures.get(key) ?? 0) + 1;
      if (attempts === 1) {
        failures.set(key, attempts);
        return { ok: false, shown: false, retry: true, error: `Answer rejected, fix it and call show_answer once more: ${error}` };
      }
      failures.delete(key);
      return { ok: false, shown: false, retry: false, error: `Answer rejected again. Do not call show_answer again; answer in prose instead: ${error}` };
    },
  });
}
