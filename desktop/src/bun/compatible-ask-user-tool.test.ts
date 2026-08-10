import { describe, expect, test } from "bun:test";
import { RequestContext } from "@mastra/core/request-context";
import { compatibleAskUserTool, normalizeAskUserInput } from "./compatible-ask-user-tool";

function askUserTestContext(agent: Record<string, unknown>) {
  return { requestContext: new RequestContext(), agent } as never;
}

describe("compatible Mastra ask_user tool", () => {
  test("normalizes provider nulls and a stray selection mode to free text", () => {
    expect(normalizeAskUserInput({
      question: "What are you curious about?",
      options: null,
      selectionMode: "single_select",
    })).toEqual({ question: "What are you curious about?" });
  });

  test("delegates an invalid provider combination to Mastra as a native free-text suspension", async () => {
    let suspended: unknown;
    const result = await compatibleAskUserTool.execute?.(
      {
        question: "What are you curious about?",
        options: null,
        selectionMode: "single_select",
      },
      askUserTestContext({ suspend: async (payload: unknown) => { suspended = payload; } }),
    );

    expect(result).toBeUndefined();
    expect(suspended).toEqual({ question: "What are you curious about?" });
  });

  test("preserves native single-select defaulting when choices exist", async () => {
    let suspended: unknown;
    await compatibleAskUserTool.execute?.(
      {
        question: "Choose a direction",
        options: [{ label: "Build", description: "Make something" }],
        selectionMode: null,
      },
      askUserTestContext({ suspend: async (payload: unknown) => { suspended = payload; } }),
    );

    expect(suspended).toEqual({
      question: "Choose a direction",
      options: [{ label: "Build", description: "Make something" }],
      selectionMode: "single_select",
    });
  });
});
