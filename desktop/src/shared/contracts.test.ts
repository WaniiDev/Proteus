import { describe, expect, test } from "bun:test";
import { modelSelectionSchema, proteusCommandSchema, proteusEventSchema } from "./contracts";

describe("PROTEUS shared contracts", () => {
  test("accepts a model selection used by Settings", () => {
    const result = modelSelectionSchema.safeParse({
      route: "openrouter-api",
      provider: "Anthropic",
      model: "anthropic/claude-sonnet-5",
      thinking: "high",
    });

    expect(result.success).toBe(true);
  });

  test("rejects an empty user message command", () => {
    const result = proteusCommandSchema.safeParse({
      type: "message.send",
      text: "",
      conversationId: "conversation-1",
    });

    expect(result.success).toBe(false);
  });

  test("accepts an interrupt command", () => {
    const result = proteusCommandSchema.safeParse({
      type: "run.interrupt",
      conversationId: "conversation-1",
    });

    expect(result.success).toBe(true);
  });

  test("rejects unknown Orb states", () => {
    const result = proteusEventSchema.safeParse({
      type: "orb.state",
      state: "unknown",
    });

    expect(result.success).toBe(false);
  });
});
