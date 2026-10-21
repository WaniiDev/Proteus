import type { ProcessInputStepArgs, ProcessInputStepResult } from "@mastra/core/processors";
import type { ProviderModel, ReasoningEffort } from "../../shared/contracts";
import { anthropicReasoningOptions } from "../providers/anthropic";
import { openRouterReasoningOptions } from "../providers/openrouter";

type ProviderOptions = NonNullable<ProcessInputStepResult["providerOptions"]>;

/**
 * The provider options that carry a thinking level to the model, keyed by provider. Only a level the model offers is
 * sent; without a selection the model's default is used. Codex models carry their level in the model itself.
 */
export function reasoningProviderOptions(model: ProviderModel | undefined, selected: ReasoningEffort | null): ProviderOptions | undefined {
  const level = selected ?? model?.reasoningEffort;
  if (!model || !level || !model.reasoningOptions?.includes(level)) return undefined;
  if (model.providerId === "anthropic") {
    const options = anthropicReasoningOptions(level);
    return options && { anthropic: options };
  }
  if (model.providerId === "openrouter") {
    const options = openRouterReasoningOptions(level);
    return options && { openrouter: options };
  }
  return undefined;
}

/** Adds the thinking level to a step's provider options without dropping options set elsewhere. */
export function withReasoning(args: Pick<ProcessInputStepArgs, "providerOptions">, result: ProcessInputStepResult | undefined, reasoning: ProviderOptions | undefined): ProcessInputStepResult | undefined {
  if (!reasoning) return result;
  const base = result?.providerOptions ?? args.providerOptions ?? {};
  const merged: ProviderOptions = { ...base };
  for (const [provider, options] of Object.entries(reasoning)) merged[provider] = { ...base[provider], ...options };
  return { ...result, providerOptions: merged };
}
