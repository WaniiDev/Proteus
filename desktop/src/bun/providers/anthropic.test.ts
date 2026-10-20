import { afterEach, describe, expect, it } from "bun:test";
import { normalizeError } from "../core/runtime-error-mapping";
import { isAnthropicModelId, listAnthropicModels } from "./anthropic";

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
});
