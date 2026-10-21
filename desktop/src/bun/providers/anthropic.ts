import Anthropic from "@anthropic-ai/sdk";
import { createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import type { AnthropicModelId, ProviderModel, ReasoningEffort } from "../../shared/contracts";

const REQUEST_TIMEOUT_MS = 15_000;

export function isAnthropicModelId(value: string): value is AnthropicModelId {
  return /^anthropic\/.+/.test(value);
}

const ANTHROPIC_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type AnthropicEffort = (typeof ANTHROPIC_EFFORTS)[number];
const DEFAULT_ANTHROPIC_EFFORT: AnthropicEffort = "medium";

/**
 * A model's thinking levels, read from the Models API capabilities: "none" when it accepts thinking turned off, then
 * every effort level it supports. Only models with adaptive thinking and effort get a slider; older budget-only models
 * keep the API default.
 */
function reasoningLevels(capabilities: Anthropic.Models.ModelCapabilities | null | undefined): Pick<ProviderModel, "reasoningOptions" | "reasoningEffort"> {
  const thinking = capabilities?.thinking;
  const effort = capabilities?.effort;
  if (!thinking?.supported || !thinking.types?.adaptive?.supported || !effort?.supported) return {};
  const levels: ReasoningEffort[] = [
    ...(thinking.types.disabled?.supported ? ["none" as const] : []),
    ...ANTHROPIC_EFFORTS.filter((level) => effort[level]?.supported),
  ];
  if (!levels.some((level) => level !== "none")) return {};
  return { reasoningOptions: levels, reasoningEffort: levels.includes(DEFAULT_ANTHROPIC_EFFORT) ? DEFAULT_ANTHROPIC_EFFORT : levels[levels.length - 1] };
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
      ...reasoningLevels(model.capabilities),
    });
  }
  return models;
}

type ReasoningOptions = { thinking: { type: "adaptive" | "disabled" }; effort?: AnthropicEffort };

/** The provider options for a thinking level: thinking off, or adaptive thinking at that effort. */
export function anthropicReasoningOptions(level: ReasoningEffort | null | undefined): ReasoningOptions | undefined {
  if (level === "none") return { thinking: { type: "disabled" } } satisfies AnthropicLanguageModelOptions;
  if (!level || !(ANTHROPIC_EFFORTS as readonly string[]).includes(level)) return undefined;
  return { thinking: { type: "adaptive" }, effort: level as AnthropicEffort } satisfies AnthropicLanguageModelOptions;
}

export function resolveAnthropicModel(modelId: AnthropicModelId, apiKey: string) {
  return createAnthropic({ apiKey })(modelId.slice("anthropic/".length));
}
