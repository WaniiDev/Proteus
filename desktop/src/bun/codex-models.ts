import type { CustomModelCatalogProvider, CustomAvailableModel } from "@mastra/core/agent-controller";
import { MastraCodeGateway, remapOpenAIModelForCodexOAuth } from "@mastra/code-sdk/agents/mastracode-gateway";
import type { ProviderModel, ProviderModelId, ReasoningEffort } from "../shared/contracts";

export const CODEX_REASONING_OPTIONS = ["low", "medium", "high", "xhigh"] as const satisfies readonly ReasoningEffort[];
export const DEFAULT_CODEX_REASONING: ReasoningEffort = "medium";

function internalCodexId(id: string): string {
  return remapOpenAIModelForCodexOAuth(id);
}

function displayName(modelName: string): string {
  return modelName
    .split("-")
    .map((part) => part === "gpt" ? "GPT" : part === "codex" ? "Codex" : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function createProteusCodexCatalogProvider(gateway: MastraCodeGateway): CustomModelCatalogProvider {
  const upstream = gateway.createModelCatalogProvider();
  return async () => {
    const unique = new Map<string, CustomAvailableModel>();
    for (const model of await upstream()) {
      if (model.provider !== "openai" || !model.modelName.startsWith("gpt-5") || !model.hasApiKey) continue;
      const id = internalCodexId(model.id);
      const modelName = id.slice("openai/".length);
      unique.set(id, { ...model, id, provider: "openai", modelName });
    }
    return [...unique.values()];
  };
}

export async function listProteusCodexModels(catalog: CustomModelCatalogProvider): Promise<ProviderModel[]> {
  return (await catalog()).map((model) => ({
    id: `codex/${model.modelName}` as ProviderModelId,
    providerId: "codex" as const,
    rawId: model.modelName,
    baseModelId: model.modelName,
    name: displayName(model.modelName),
    description: "ChatGPT subscription via the upstream MastraCode gateway.",
    reasoningOptions: [...CODEX_REASONING_OPTIONS],
    inputModalities: ["text"],
    outputModalities: ["text"],
  }));
}

export function migrateCodexSelection(modelId: ProviderModelId, reasoningEffort?: ReasoningEffort): { modelId: ProviderModelId; reasoningEffort: ReasoningEffort } {
  const raw = modelId.slice("codex/".length);
  const legacy = raw.match(/^(.*)\[([^\]]+)]$/);
  const bare = legacy?.[1] ?? raw;
  const legacyEffort = legacy?.[2] as ReasoningEffort | undefined;
  const remapped = internalCodexId(`openai/${bare}`).slice("openai/".length);
  const effort = CODEX_REASONING_OPTIONS.includes(reasoningEffort as typeof CODEX_REASONING_OPTIONS[number])
    ? reasoningEffort!
    : CODEX_REASONING_OPTIONS.includes(legacyEffort as typeof CODEX_REASONING_OPTIONS[number])
      ? legacyEffort!
      : DEFAULT_CODEX_REASONING;
  return { modelId: `codex/${remapped}`, reasoningEffort: effort };
}
