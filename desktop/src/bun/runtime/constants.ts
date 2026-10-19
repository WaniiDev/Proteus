import type { OpenRouterModelId, ProviderId } from "../../shared/contracts";
import type { AppModelSelection } from "../model-preferences";

export const AGENT_ID = "proteus-text-agent";
export const RESOURCE_ID = "local-user";
export const THREAD_METADATA_KEY = "proteus.ui.v2";
export const LEGACY_THREAD_METADATA_KEY = "proteus.workbench.v1";
export const DEFAULT_MODEL_ID: OpenRouterModelId = "openrouter/auto";
export const DEFAULT_PROVIDER_ID: ProviderId = "openrouter";
export const DEFAULT_MODEL_SELECTION: AppModelSelection = { providerId: DEFAULT_PROVIDER_ID, modelId: DEFAULT_MODEL_ID };
export const MAX_INPUT_LENGTH = 32_000;
export const CONTINUATION_SLOW_MS = 30_000;
export const CONTINUATION_RECOVERY_MS = 120_000;
export const CONTINUATION_PROGRESS_PERSIST_MS = 5_000;
