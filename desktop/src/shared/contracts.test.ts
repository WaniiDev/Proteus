import { describe, expect, it } from "bun:test";
import { openRouterModelIdSchema, runtimeSnapshotSchema } from "./contracts";

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
      activeRun: null,
      error: null,
    });
    expect(snapshot.selectedModelId).toBe("openrouter/auto");
  });
});
