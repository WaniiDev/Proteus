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
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({
      data: [
        {
          id: "openai/gpt-4.1",
          name: "GPT-4.1",
          created: 1_735_689_600,
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
    }), { status: 200 });
    }) as unknown as typeof fetch;

    const models = await listOpenRouterTextModels("sk-or-v1-test");
    expect(models.map((model) => model.id)).toEqual(["openrouter/auto", "openrouter/openai/gpt-4.1"]);
    expect(models[1]?.promptPrice).toBe(0.000002);
    expect(models[1]?.contextLength).toBe(128000);
    expect(models[1]?.reasoningOptions).toEqual(["low", "medium", "high"]);
    expect(models[1]?.reasoningEffort).toBe("medium");
    expect(models[1]?.createdAt).toBe("2025-01-01T00:00:00.000Z");
    expect(models[1]?.popularityRank).toBe(1);
    expect(requestedUrls).toContain("https://openrouter.ai/api/v1/models/user");
    expect(requestedUrls).toContain("https://openrouter.ai/api/v1/models?sort=most-popular");
  });

  it("offers every effort OpenRouter accepts, and Off when reasoning is optional", async () => {
    const entry = (id: string, reasoning: Record<string, unknown>) => ({ id, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, reasoning });
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [
      entry("openai/gpt-5", { supported_efforts: ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"], default_effort: "medium", mandatory: true }),
      entry("anthropic/claude-sonnet", { supported_efforts: ["low", "medium", "high"], default_effort: "high", default_enabled: false, mandatory: false }),
      entry("deepseek/r1", { supported_efforts: [], mandatory: false }),
    ] }), { status: 200 })) as unknown as typeof fetch;

    const [, gpt, sonnet, r1] = await listOpenRouterTextModels("sk-or-v1-test");
    expect(gpt).toMatchObject({ reasoningOptions: ["minimal", "low", "medium", "high", "xhigh", "max"], reasoningEffort: "medium" });
    expect(sonnet).toMatchObject({ reasoningOptions: ["none", "low", "medium", "high"], reasoningEffort: "none" });
    expect(r1?.reasoningOptions).toBeUndefined();
  });

  it("keeps the private catalog when popularity ranking is unavailable", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => String(input).includes("sort=most-popular")
      ? new Response("unavailable", { status: 503 })
      : new Response(JSON.stringify({ data: [{
        id: "anthropic/claude",
        name: "Claude",
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      }] }), { status: 200 })) as unknown as typeof fetch;

    const models = await listOpenRouterTextModels("sk-or-v1-test");
    expect(models.map((model) => model.id)).toEqual(["openrouter/auto", "openrouter/anthropic/claude"]);
    expect(models[1]?.popularityRank).toBeUndefined();
  });

  it("reads provider status from common error shapes", () => {
    expect(getOpenRouterErrorStatus({ status: 429 })).toBe(429);
    expect(getOpenRouterErrorStatus({ statusCode: 401 })).toBe(401);
    expect(getOpenRouterErrorStatus({ response: { status: 403 } })).toBe(403);
  });
});
