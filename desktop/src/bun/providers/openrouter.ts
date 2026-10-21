import { ModelsDevGateway, type ProviderConfig } from "@mastra/core/llm";
import { DEFAULT_MODEL_ID } from "../../shared/constants";
import type { OpenRouterModel, OpenRouterModelId, ProviderErrorCode, ReasoningEffort } from "../../shared/contracts";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const REQUEST_TIMEOUT_MS = 15_000;

type OpenRouterApiError = Error & { status?: number; code?: ProviderErrorCode };

type RawOpenRouterModel = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  created?: unknown;
  context_length?: unknown;
  architecture?: {
    input_modalities?: unknown;
    output_modalities?: unknown;
  };
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
  };
  reasoning?: {
    supported_efforts?: unknown;
    default_effort?: unknown;
    default_enabled?: unknown;
    mandatory?: unknown;
  };
};

type OpenRouterModelsResponse = { data?: RawOpenRouterModel[] };

function makeError(message: string, status?: number): OpenRouterApiError {
  const error = new Error(message) as OpenRouterApiError;
  error.status = status;
  return error;
}

function safeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function safeStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fallback;
}

export function canonicalizeOpenRouterModelId(rawId: string): OpenRouterModelId {
  const trimmed = rawId.trim();
  return (trimmed.startsWith("openrouter/") ? trimmed : `openrouter/${trimmed}`) as OpenRouterModelId;
}

export function isOpenRouterModelId(value: string): value is OpenRouterModelId {
  return /^openrouter\/.+/.test(value);
}

async function requestJson<T>(path: string, apiKey: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw makeError(`OpenRouter control request failed (${response.status})`, response.status);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw makeError("OpenRouter control request timed out", 408);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateOpenRouterKey(apiKey: string): Promise<void> {
  await requestJson<{ data?: unknown }>("/key", apiKey);
}

/** The `reasoning.effort` values OpenRouter accepts, in runtime order. */
const OPENROUTER_EFFORTS: readonly ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * A model's reasoning levels from its catalog entry: the efforts it supports, plus "none" when reasoning is optional.
 * The default is "none" for a model that does not reason unless asked, otherwise its default effort.
 */
function reasoningLevels(reasoning: RawOpenRouterModel["reasoning"]): Pick<OpenRouterModel, "reasoningOptions" | "reasoningEffort"> {
  const supported = new Set(safeStringArray(reasoning?.supported_efforts, []));
  if (supported.size === 0) return {};
  if (reasoning?.mandatory === false) supported.add("none");
  const levels = OPENROUTER_EFFORTS.filter((level) => supported.has(level));
  if (!levels.some((level) => level !== "none")) return {};
  const fallback = reasoning?.default_enabled === false && levels.includes("none") ? "none" : undefined;
  const preferred = levels.find((level) => level === reasoning?.default_effort);
  const reasoningEffort = fallback ?? preferred;
  return { reasoningOptions: levels, ...(reasoningEffort ? { reasoningEffort } : {}) };
}

/** The provider options for a reasoning level: reasoning off, or reasoning at that effort. */
export function openRouterReasoningOptions(level: ReasoningEffort): { reasoning: { enabled: false } | { effort: ReasoningEffort } } | undefined {
  if (level === "none") return { reasoning: { enabled: false } };
  return OPENROUTER_EFFORTS.includes(level) ? { reasoning: { effort: level } } : undefined;
}

function mapModel(raw: RawOpenRouterModel): OpenRouterModel | null {
  if (typeof raw.id !== "string" || raw.id.trim() === "") return null;
  const inputModalities = safeStringArray(raw.architecture?.input_modalities, []);
  const outputModalities = safeStringArray(raw.architecture?.output_modalities, []);
  if (!inputModalities.includes("text") || !outputModalities.includes("text")) return null;

  const contextLength = typeof raw.context_length === "number" && Number.isInteger(raw.context_length) && raw.context_length > 0
    ? raw.context_length
    : undefined;
  const { reasoningOptions, reasoningEffort } = reasoningLevels(raw.reasoning);

  return {
    id: canonicalizeOpenRouterModelId(raw.id),
    providerId: "openrouter",
    rawId: raw.id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : raw.id,
    description: typeof raw.description === "string" ? raw.description : undefined,
    contextLength,
    promptPrice: safeNumber(raw.pricing?.prompt),
    completionPrice: safeNumber(raw.pricing?.completion),
    ...(typeof raw.created === "number" && Number.isFinite(raw.created) && raw.created > 0
      ? { createdAt: new Date(raw.created * 1_000).toISOString() }
      : {}),
    inputModalities,
    outputModalities,
    ...(reasoningOptions ? { reasoningOptions } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

export async function listOpenRouterTextModels(apiKey: string): Promise<OpenRouterModel[]> {
  const [response, popularityResponse] = await Promise.all([
    requestJson<OpenRouterModelsResponse>("/models/user", apiKey),
    requestJson<OpenRouterModelsResponse>("/models?sort=most-popular", apiKey).catch(() => ({ data: [] })),
  ]);
  const popularityRanks = new Map(
    (popularityResponse.data ?? []).flatMap((model, index) => typeof model.id === "string" ? [[model.id, index + 1] as const] : []),
  );
  const mapped = (response.data ?? [])
    .map(mapModel)
    .filter((model): model is OpenRouterModel => model !== null)
    .map((model) => ({ ...model, ...(popularityRanks.has(model.rawId) ? { popularityRank: popularityRanks.get(model.rawId) } : {}) }));

  const autoRouter: OpenRouterModel = {
    id: DEFAULT_MODEL_ID,
    providerId: "openrouter",
    rawId: "auto",
    name: "Auto Router",
    description: "Let OpenRouter choose a suitable text model for each request.",
    inputModalities: ["text"],
    outputModalities: ["text"],
  };

  return [autoRouter, ...mapped.filter((model) => model.id !== autoRouter.id)];
}

export function getOpenRouterErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  if (typeof record.status === "number") return record.status;
  if (typeof record.statusCode === "number") return record.statusCode;
  return typeof record.response?.status === "number" ? record.response.status : undefined;
}

export const OPENROUTER_PROVIDER_CONFIG: ProviderConfig = {
  url: "https://openrouter.ai/api/v1",
  apiKeyEnvVar: "OPENROUTER_API_KEY",
  name: "OpenRouter",
  models: ["auto"],
  gateway: "models.dev",
  npm: "@openrouter/ai-sdk-provider",
};

/** Keep Mastra's model registry scoped to OpenRouter for this product. */
export class ProteusOpenRouterGateway extends ModelsDevGateway {
  constructor() {
    super({ openrouter: OPENROUTER_PROVIDER_CONFIG });
  }

  override async fetchProviders(): Promise<Record<string, ProviderConfig>> {
    return { openrouter: OPENROUTER_PROVIDER_CONFIG };
  }
}

export const openRouterGateway = new ProteusOpenRouterGateway();
