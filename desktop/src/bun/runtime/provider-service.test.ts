import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { CredentialVault } from "../providers/credentials";
import { RuntimeContext } from "./context";

let ProviderService: typeof import("./provider-service").ProviderService;
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  mock.module("electrobun/bun", () => ({ Utils: { paths: { userData: "" }, openExternal: () => undefined } }));
  ({ ProviderService } = await import("./provider-service"));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function memoryVault(initial: string | null = null): CredentialVault & { value: string | null } {
  const vault = {
    value: initial,
    get: async () => vault.value,
    set: async (apiKey: string) => { vault.value = apiKey; },
    delete: async () => { vault.value = null; },
  };
  return vault;
}

function anthropicModels(status = 200) {
  globalThis.fetch = (async () => new Response(
    status === 200
      ? JSON.stringify({ data: [{ type: "model", id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-09-01T00:00:00Z", lifecycle: "active", max_input_tokens: 1_000_000, max_tokens: 128_000, capabilities: null, deprecated_at: null, retires_at: null, line: null }], has_more: false, first_id: "claude-opus-5-5", last_id: "claude-opus-5-5" })
      : JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }),
    { status, headers: { "content-type": "application/json" } },
  )) as unknown as typeof fetch;
}

function fixture(anthropicVault: CredentialVault) {
  const ctx = new RuntimeContext();
  const service = new ProviderService(ctx, {
    vault: memoryVault(),
    anthropicVault,
    codexCredentialStore: {} as never,
    codexCatalogProvider: (async () => []) as never,
    modelPreferences: {} as never,
    threads: {} as never,
    abortRun: () => undefined,
  });
  const anthropic = () => ctx.snapshot.providers.find((provider) => provider.id === "anthropic")!;
  return { ctx, service, anthropic };
}

describe("Anthropic provider connection", () => {
  test("stores a key only after the Models API accepts it and publishes its catalog", async () => {
    const vault = memoryVault();
    const { ctx, service, anthropic } = fixture(vault);

    anthropicModels(401);
    await expect(service.connectProvider("anthropic", { apiKey: "sk-ant-bad" })).rejects.toMatchObject({ code: "invalid-credential" });
    expect(vault.value).toBeNull();
    expect(anthropic()).toMatchObject({ configured: false, verified: false, detail: "That Anthropic API key is invalid or disabled." });

    anthropicModels();
    await service.connectProvider("anthropic", { apiKey: " sk-ant-good " });
    expect(vault.value).toBe("sk-ant-good");
    expect(anthropic()).toMatchObject({ configured: true, verified: true, availability: "ready" });
    expect(ctx.snapshot.models.filter((model) => model.providerId === "anthropic").map((model) => model.id)).toEqual(["anthropic/claude-opus-5-5"]);

    await service.disconnectProvider("anthropic");
    expect(vault.value).toBeNull();
    expect(anthropic()).toMatchObject({ configured: false, verified: false, availability: "needs-configuration" });
    expect(ctx.snapshot.models.some((model) => model.providerId === "anthropic")).toBe(false);
  });

  test("marks a stored key unavailable when Anthropic rejects it on refresh", async () => {
    const { service, anthropic } = fixture(memoryVault("sk-ant-revoked"));
    anthropicModels(401);
    await service.refreshAnthropicModels();
    expect(anthropic()).toMatchObject({ configured: true, verified: false, availability: "unavailable", detail: "That Anthropic API key is invalid or disabled." });
  });
});
