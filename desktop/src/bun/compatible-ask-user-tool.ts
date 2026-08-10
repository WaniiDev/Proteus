import { askUserTool, createTool } from "@mastra/core/tools";
import { z } from "zod";

const askUserOptionSchema = z.object({
  label: z.string().describe("Short display text for this option (1-5 words)"),
  description: z.string().optional().describe("Explanation of what this option means"),
});

const compatibleAskUserInputSchema = z.object({
  question: z.string().min(1).describe("The clear, specific question to ask the user."),
  options: z.array(askUserOptionSchema).nullable().optional().describe("Optional choices. Omit or send null for a free-text question."),
  selectionMode: z.enum(["single_select", "multi_select"]).nullable().optional().describe("Only applies when non-empty options are provided."),
});

export type CompatibleAskUserInput = z.infer<typeof compatibleAskUserInputSchema>;

/**
 * Providers sometimes serialize omitted optional fields as null, or emit the
 * default single-select mode without choices. Mastra intentionally rejects that
 * combination, so normalize it to the documented free-text shape before calling
 * the unmodified built-in tool.
 */
export function normalizeAskUserInput(input: CompatibleAskUserInput) {
  const options = input.options?.length ? input.options : undefined;
  return {
    question: input.question,
    ...(options ? { options } : {}),
    ...(options && input.selectionMode ? { selectionMode: input.selectionMode } : {}),
  };
}

const executeNativeAskUser = askUserTool.execute;
if (!executeNativeAskUser) throw new Error("Mastra askUserTool is missing its native execute handler.");

/**
 * Compatibility boundary around Mastra's native askUserTool. Suspension,
 * persistence, resume formatting, and terminal results remain framework-owned.
 */
export const compatibleAskUserTool = createTool({
  id: askUserTool.id,
  description: `${askUserTool.description} For a free-text question, omit options and selectionMode; null optional fields are accepted for provider compatibility.`,
  inputSchema: compatibleAskUserInputSchema,
  suspendSchema: askUserTool.suspendSchema,
  resumeSchema: askUserTool.resumeSchema,
  execute: async (input, context) => executeNativeAskUser(normalizeAskUserInput(input), context as never),
});
