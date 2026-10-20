import Anthropic from "@anthropic-ai/sdk";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { AnthropicModelId, ProviderModel } from "../../shared/contracts";

const REQUEST_TIMEOUT_MS = 15_000;

export function isAnthropicModelId(value: string): value is AnthropicModelId {
  return /^anthropic\/.+/.test(value);
}

/**
 * List the Claude models this API key can use. The Models API rejects an
 * invalid key, so a successful listing also validates the credential.
 */
export async function listAnthropicModels(apiKey: string): Promise<ProviderModel[]> {
  const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });
  const models: ProviderModel[] = [];
  for await (const model of client.models.list({ limit: 1000 })) {
    if (model.lifecycle === "retired") continue;
    models.push({
      id: `anthropic/${model.id}`,
      providerId: "anthropic",
      rawId: model.id,
      name: model.display_name || model.id,
      ...(model.max_input_tokens && model.max_input_tokens > 0 ? { contextLength: model.max_input_tokens } : {}),
      ...(Date.parse(model.created_at) > 0 ? { createdAt: new Date(model.created_at).toISOString() } : {}),
      inputModalities: ["text"],
      outputModalities: ["text"],
    });
  }
  return models;
}

export function resolveAnthropicModel(modelId: AnthropicModelId, apiKey: string) {
  return createAnthropic({ apiKey })(modelId.slice("anthropic/".length));
}
