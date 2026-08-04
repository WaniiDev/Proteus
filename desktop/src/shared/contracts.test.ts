import { describe, expect, it } from "bun:test";
import { openRouterModelIdSchema, pendingInteractionSchema, runtimeSnapshotSchema } from "./contracts";

describe("OpenRouter contracts", () => {
  it("accepts only OpenRouter model IDs", () => {
    expect(openRouterModelIdSchema.parse("openrouter/auto")).toBe("openrouter/auto");
    expect(() => openRouterModelIdSchema.parse("openai/gpt-4.1")).toThrow();
  });

  it("validates a complete runtime snapshot", () => {
    const snapshot = runtimeSnapshotSchema.parse({
      status: "ready",
      credential: { configured: true, verified: true },
      models: [{ id: "openrouter/auto", rawId: "auto", name: "Auto Router" }],
      selectedModelId: "openrouter/auto",
      threads: [],
      activeThreadId: null,
      messages: [],
      events: [],
      interactions: [],
      workbench: {
        status: "idle",
        tasks: [],
        pendingInteractions: [],
        queuedFollowUpCount: 0,
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      },
      activeRun: null,
      error: null,
    });
    expect(snapshot.selectedModelId).toBe("openrouter/auto");
  });

  it("keeps resumable interaction and raw plan history data", () => {
    const interaction = pendingInteractionSchema.parse({
      id: "tool-1",
      toolCallId: "tool-1",
      kind: "submit_plan",
      title: "Plan review",
      options: [],
      plan: {
        version: 2,
        title: "Plan review",
        summary: "A concise summary.",
        steps: ["Do the work"],
        raw: "# Plan review\n\nA concise summary.\n\n- Do the work",
        status: "approved",
        feedback: "Looks good",
      },
      status: "failed",
      originMessageId: "user-turn-1",
      error: {
        code: "resume-denied",
        message: "Mastra denied this plan response.",
        retryable: true,
      },
      createdAt: new Date().toISOString(),
    });
    expect(interaction.status).toBe("failed");
    expect(interaction.originMessageId).toBe("user-turn-1");
    expect(interaction.error?.code).toBe("resume-denied");
    expect(interaction.plan?.raw).toContain("Do the work");
  });
});
