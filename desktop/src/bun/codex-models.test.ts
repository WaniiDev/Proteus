import { describe, expect, it } from "bun:test";
import type { CustomModelCatalogProvider } from "@mastra/core/agent-controller";
import { MastraCodeGateway } from "@mastra/code-sdk/agents/mastracode-gateway";
import type { CredentialStore } from "@mastra/code-sdk/auth/types";
import { createProteusCodexCatalogProvider, listProteusCodexModels, migrateCodexSelection } from "./codex-models";

describe("MastraCode Codex model projection", () => {
  it("projects only upstream catalog entries into stable product IDs", async () => {
    const catalog: CustomModelCatalogProvider = async () => [
      { id: "openai/gpt-5.6-sol", provider: "openai", modelName: "gpt-5.6-sol", hasApiKey: true },
      { id: "openai/gpt-5.4-mini", provider: "openai", modelName: "gpt-5.4-mini", hasApiKey: true },
    ];

    const models = await listProteusCodexModels(catalog);

    expect(models.map((model) => model.id)).toEqual(["codex/gpt-5.6-sol", "codex/gpt-5.4-mini"]);
    expect(models[0]?.reasoningOptions).toEqual(["low", "medium", "high", "xhigh"]);
    expect(models.every((model) => model.reasoningEffort === undefined)).toBe(true);
  });

  it("migrates ACP composite selections and upstream aliases", () => {
    expect(migrateCodexSelection("codex/gpt-5.3[high]")).toEqual({ modelId: "codex/gpt-5.3-codex", reasoningEffort: "high" });
    expect(migrateCodexSelection("codex/gpt-5.6-sol")).toEqual({ modelId: "codex/gpt-5.6-sol", reasoningEffort: "medium" });
  });

  it("filters the real upstream MastraCode catalog to authenticated GPT-5 models", async () => {
    const credentials: CredentialStore = {
      allowEnvironmentFallback: false,
      reload() {},
      get: (provider) => provider === "openai-codex" ? { type: "oauth", access: "test", refresh: "test", expires: Date.now() + 60_000 } : undefined,
      getStoredApiKey: () => undefined,
      getApiKey: async () => "test",
    };
    const gateway = new MastraCodeGateway({
      mastraGatewayBaseUrl: "https://gateway-api.mastra.ai",
      routeThroughMastraGateway: false,
      credentialStore: credentials,
    });

    const models = await createProteusCodexCatalogProvider(gateway)();

    expect(models.length).toBeGreaterThan(0);
    expect(models.every((model) => model.provider === "openai" && model.modelName.startsWith("gpt-5") && model.hasApiKey)).toBe(true);
    expect(models.some((model) => model.modelName === "gpt-5.6-sol")).toBe(true);
  });
});
