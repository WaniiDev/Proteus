import { afterEach, describe, expect, it } from "bun:test";
import {
  canonicalizeOpenRouterModelId,
  getOpenRouterErrorStatus,
  isOpenRouterModelId,
  listOpenRouterTextModels,
  validateOpenRouterKey,
} from "./openrouter";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OpenRouter control-plane client", () => {
  it("canonicalizes and guards product model IDs", () => {
    expect(canonicalizeOpenRouterModelId("anthropic/claude-sonnet")).toBe("openrouter/anthropic/claude-sonnet");
    expect(canonicalizeOpenRouterModelId("openrouter/auto")).toBe("openrouter/auto");
    expect(isOpenRouterModelId("openrouter/auto")).toBe(true);
    expect(isOpenRouterModelId("openai/gpt-4.1")).toBe(false);
  });

  it("validates a key through the OpenRouter key endpoint", async () => {
    let requestedUrl = "";
    let requestedAuthorization = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedAuthorization = new Headers(init?.headers).get("Authorization") ?? "";
      return new Response(JSON.stringify({ data: { label: "test" } }), { status: 200 });
    }) as unknown as typeof fetch;

    await validateOpenRouterKey("sk-or-v1-test");
    expect(requestedUrl).toBe("https://openrouter.ai/api/v1/key");
    expect(requestedAuthorization).toBe("Bearer sk-or-v1-test");
  });

  it("returns only text-capable account models and always includes auto routing", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [
        {
          id: "openai/gpt-4.1",
          name: "GPT-4.1",
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
          context_length: 128000,
          pricing: { prompt: "0.000002", completion: "0.000008" },
          reasoning: { supported_efforts: ["low", "medium", "high"], default_effort: "medium" },
        },
        {
          id: "openai/gpt-image-1",
          name: "Image model",
          architecture: { input_modalities: ["text", "image"], output_modalities: ["image"] },
        },
        { id: "broken-model", architecture: { input_modalities: ["text"] } },
      ],
    }), { status: 200 })) as unknown as typeof fetch;

    const models = await listOpenRouterTextModels("sk-or-v1-test");
    expect(models.map((model) => model.id)).toEqual(["openrouter/auto", "openrouter/openai/gpt-4.1"]);
    expect(models[1]?.promptPrice).toBe(0.000002);
    expect(models[1]?.contextLength).toBe(128000);
    expect(models[1]?.reasoningOptions).toEqual(["low", "medium", "high"]);
    expect(models[1]?.reasoningEffort).toBe("medium");
  });

  it("reads provider status from common error shapes", () => {
    expect(getOpenRouterErrorStatus({ status: 429 })).toBe(429);
    expect(getOpenRouterErrorStatus({ statusCode: 401 })).toBe(401);
    expect(getOpenRouterErrorStatus({ response: { status: 403 } })).toBe(403);
  });
});
