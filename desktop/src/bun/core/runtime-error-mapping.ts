import type { ProviderErrorCode, RuntimeError } from "../../shared/contracts";
import { extractSafeErrorMessage } from "./error-message";
import { SecureStoreUnavailableError } from "../providers/credentials";
import { getOpenRouterErrorStatus } from "../providers/openrouter";

export function workspaceRuntimeError(error: unknown): RuntimeError | null {
  const message = extractSafeErrorMessage(error, "");
  if (/project folder is unavailable|selected project folder is unavailable/i.test(message)) {
    return {
      code: "workspace-unavailable",
      message: "This chat's project folder is unavailable. Reconnect it from Projects before continuing.",
      retryable: false,
    };
  }
  if (
    /(?:ENOENT|EACCES|EPERM).*(?:proteus-workspace-v1|workspace)|(?:proteus-workspace-v1|workspace).*(?:ENOENT|EACCES|EPERM)/i.test(
      message,
    )
  ) {
    return {
      code: "workspace-unavailable",
      message: "Proteus could not open its local workspace. Check folder permissions, then restart Proteus.",
      retryable: true,
    };
  }
  return null;
}

export const USER_FACING_ERRORS: Record<ProviderErrorCode, { message: string; retryable: boolean }> = {
  "invalid-credential": {
    message: "That OpenRouter key is invalid or disabled.",
    retryable: false,
  },
  "insufficient-credits": {
    message: "OpenRouter needs credits before this request can run.",
    retryable: false,
  },
  forbidden: {
    message: "OpenRouter refused this request for the current account.",
    retryable: false,
  },
  "model-unavailable": {
    message: "The selected OpenRouter model is unavailable.",
    retryable: true,
  },
  "context-too-large": {
    message: "This conversation is too large for the selected model. Start a new chat or shorten the message.",
    retryable: false,
  },
  "rate-limited": {
    message: "OpenRouter is rate-limiting requests. Try again shortly.",
    retryable: true,
  },
  timeout: { message: "OpenRouter took too long to respond.", retryable: true },
  offline: {
    message: "OpenRouter could not be reached. Check your connection and retry.",
    retryable: true,
  },
  aborted: { message: "The response was stopped.", retryable: true },
  busy: { message: "A response is already running.", retryable: true },
  "secure-store-unavailable": {
    message: "Windows Credential Manager is unavailable, so Proteus cannot use a key safely.",
    retryable: false,
  },
  "catalog-unavailable": {
    message: "The OpenRouter model catalog could not be refreshed.",
    retryable: true,
  },
  "workspace-unavailable": {
    message: "The selected workspace is unavailable.",
    retryable: true,
  },
  unknown: {
    message: "The text model could not complete this request.",
    retryable: true,
  },
};

export function makeRuntimeError(code: ProviderErrorCode): RuntimeError {
  const details = USER_FACING_ERRORS[code];
  return { code, message: details.message, retryable: details.retryable };
}

function findStatus(error: unknown): number | undefined {
  const direct = getOpenRouterErrorStatus(error);
  if (direct !== undefined) return direct;
  if (error && typeof error === "object") {
    const record = error as {
      statusCode?: unknown;
      response?: { status?: unknown };
      cause?: unknown;
    };
    if (typeof record.statusCode === "number") return record.statusCode;
    if (typeof record.response?.status === "number") return record.response.status;
    if (record.cause !== undefined) return findStatus(record.cause);
  }
  return undefined;
}

function findMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "";
}

export function normalizeError(error: unknown): RuntimeError {
  if (error && typeof error === "object" && "code" in error && "message" in error && "retryable" in error) {
    return error as RuntimeError;
  }
  if (error instanceof SecureStoreUnavailableError) return makeRuntimeError("secure-store-unavailable");
  const workspaceError = workspaceRuntimeError(error);
  if (workspaceError) return workspaceError;

  const status = findStatus(error);
  if (status === 401) return makeRuntimeError("invalid-credential");
  if (status === 402) return makeRuntimeError("insufficient-credits");
  if (status === 403) return makeRuntimeError("forbidden");
  if (status === 404) return makeRuntimeError("model-unavailable");
  if (status === 408) return makeRuntimeError("timeout");
  if (status === 429) return makeRuntimeError("rate-limited");
  if (status === 400 && /context|token|length/i.test(findMessage(error))) return makeRuntimeError("context-too-large");
  if (status && status >= 500) return makeRuntimeError("offline");

  const message = findMessage(error);
  if (/no verified|api key|credential/i.test(message)) return makeRuntimeError("invalid-credential");
  if (/abort|cancel/i.test(message)) return makeRuntimeError("aborted");
  if (/network|fetch|connect|socket|offline|timed out/i.test(message)) return makeRuntimeError("offline");
  const safeMessage = extractSafeErrorMessage(error, "");
  return safeMessage ? { code: "unknown", message: safeMessage, retryable: true } : makeRuntimeError("unknown");
}
