import type { OpenRouterModel, OpenRouterModelId, ProviderErrorCode } from "../shared/contracts";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const REQUEST_TIMEOUT_MS = 15_000;

type OpenRouterApiError = Error & { status?: number; code?: ProviderErrorCode };

type RawOpenRouterModel = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  context_length?: unknown;
  architecture?: {
    input_modalities?: unknown;
    output_modalities?: unknown;
  };
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
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

function mapModel(raw: RawOpenRouterModel): OpenRouterModel | null {
  if (typeof raw.id !== "string" || raw.id.trim() === "") return null;
  const inputModalities = safeStringArray(raw.architecture?.input_modalities, []);
  const outputModalities = safeStringArray(raw.architecture?.output_modalities, []);
  if (!inputModalities.includes("text") || !outputModalities.includes("text")) return null;

  const contextLength = typeof raw.context_length === "number" && Number.isInteger(raw.context_length) && raw.context_length > 0
    ? raw.context_length
    : undefined;

  return {
    id: canonicalizeOpenRouterModelId(raw.id),
    rawId: raw.id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : raw.id,
    description: typeof raw.description === "string" ? raw.description : undefined,
    contextLength,
    promptPrice: safeNumber(raw.pricing?.prompt),
    completionPrice: safeNumber(raw.pricing?.completion),
    inputModalities,
    outputModalities,
  };
}

export async function listOpenRouterTextModels(apiKey: string): Promise<OpenRouterModel[]> {
  const response = await requestJson<OpenRouterModelsResponse>("/models/user", apiKey);
  const mapped = (response.data ?? [])
    .map(mapModel)
    .filter((model): model is OpenRouterModel => model !== null)
    .sort((left, right) => left.name.localeCompare(right.name));

  const autoRouter: OpenRouterModel = {
    id: "openrouter/auto",
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
