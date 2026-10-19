import type { OpenRouterModelId } from "./contracts";

/** Longest user message the composer accepts and the runtime sends. */
export const MAX_INPUT_LENGTH = 32_000;
/** The OpenRouter auto-router: the default model and the always-listed catalog entry. */
export const DEFAULT_MODEL_ID: OpenRouterModelId = "openrouter/auto";
