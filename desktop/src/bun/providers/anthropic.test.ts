import { afterEach, describe, expect, it } from "bun:test";
import { normalizeError } from "../core/runtime-error-mapping";
import { isAnthropicModelId, listAnthropicModels, resolveAnthropicModel } from "./anthropic";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function model(id: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "model",
    id,
    display_name: id,
    created_at: "2026-09-01T00:00:00Z",
    lifecycle: "active",
    max_input_tokens: 1_000_000,
    max_tokens: 128_000,
    capabilities: null,
    deprecated_at: null,
    retires_at: null,
    line: null,
    ...overrides,
  };
}

describe("Anthropic control-plane client", () => {
  it("guards product model IDs", () => {
    expect(isAnthropicModelId("anthropic/claude-opus-5-5")).toBe(true);
    expect(isAnthropicModelId("openrouter/anthropic/claude-opus-5-5")).toBe(false);
  });

  it("lists usable Claude models with the API key and skips retired ones", async () => {
    let requestedUrl = "";
    let requestedKey = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedKey = new Headers(init?.headers).get("x-api-key") ?? "";
      return new Response(JSON.stringify({
        data: [
          model("claude-opus-5-5", { display_name: "Claude Opus 5.5" }),
          model("claude-haiku-4-5", { max_input_tokens: null }),
          model("claude-2-1", { lifecycle: "retired" }),
        ],
        has_more: false,
        first_id: "claude-opus-5-5",
        last_id: "claude-2-1",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const models = await listAnthropicModels("sk-ant-test");

    expect(requestedUrl).toStartWith("https://api.anthropic.com/v1/models");
    expect(requestedKey).toBe("sk-ant-test");
    expect(models.map((entry) => entry.id)).toEqual(["anthropic/claude-opus-5-5", "anthropic/claude-haiku-4-5"]);
    expect(models[0]).toMatchObject({ providerId: "anthropic", rawId: "claude-opus-5-5", name: "Claude Opus 5.5", contextLength: 1_000_000 });
    expect(models[1]?.contextLength).toBeUndefined();
  });

  it("surfaces a rejected key as an invalid credential", async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }),
      { status: 401, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;

    const error = await listAnthropicModels("sk-ant-bad").catch((caught: unknown) => caught);
    expect(normalizeError(error).code).toBe("invalid-credential");
  });

  it("offers the thinking levels each model's capabilities report", async () => {
    const support = (supported: boolean) => ({ supported });
    const capabilities = (disabled: boolean, efforts: string[]) => ({
      thinking: { supported: true, types: { adaptive: support(true), enabled: support(false), disabled: support(disabled), between_tools: support(false) } },
      effort: { supported: true, ...Object.fromEntries(["low", "medium", "high", "xhigh", "max"].map((level) => [level, support(efforts.includes(level))])) },
    });
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [
        model("claude-opus-5-5", { capabilities: capabilities(false, ["low", "medium", "high", "xhigh", "max"]) }),
        model("claude-opus-4-8", { capabilities: capabilities(true, ["low", "medium", "high", "xhigh", "max"]) }),
        model("claude-haiku-4-5", { capabilities: { thinking: { supported: true, types: { adaptive: support(false), enabled: support(true), disabled: support(true), between_tools: support(false) } }, effort: { supported: false } } }),
        model("claude-legacy", { capabilities: null }),
      ],
      has_more: false,
    }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

    const [opus55, opus48, haiku, legacy] = await listAnthropicModels("sk-ant-test");
    expect(opus55).toMatchObject({ reasoningOptions: ["low", "medium", "high", "xhigh", "max"], reasoningEffort: "medium" });
    expect(opus48).toMatchObject({ reasoningOptions: ["none", "low", "medium", "high", "xhigh", "max"], reasoningEffort: "medium" });
    expect(haiku?.reasoningOptions).toBeUndefined();
    expect(legacy?.reasoningOptions).toBeUndefined();
  });

  it("sends the selected thinking level with every request", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        id: "msg_1", type: "message", role: "assistant", model: "claude-opus-4-8", content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const call = { prompt: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }] };

    await resolveAnthropicModel("anthropic/claude-opus-4-8", "sk-ant-test", "xhigh").doGenerate(call);
    await resolveAnthropicModel("anthropic/claude-opus-4-8", "sk-ant-test", "none").doGenerate(call);
    await resolveAnthropicModel("anthropic/claude-opus-4-8", "sk-ant-test", null).doGenerate(call);

    expect(bodies[0]).toMatchObject({ thinking: { type: "adaptive" }, output_config: { effort: "xhigh" } });
    expect(bodies[1]).toMatchObject({ thinking: { type: "disabled" } });
    expect(bodies[1]?.output_config).toBeUndefined();
    expect(bodies[2]?.thinking).toBeUndefined();
    expect(bodies[2]?.output_config).toBeUndefined();
  });
});
