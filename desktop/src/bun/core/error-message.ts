import { sanitizeDiagnosticValue } from "./diagnostics";

function rawErrorMessage(value: unknown): unknown {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return value;
  const record = value as {
    message?: unknown;
    details?: { errorMessage?: unknown };
    error?: unknown;
  };
  if (typeof record.message === "string") return record.message;
  if (typeof record.details?.errorMessage === "string") return record.details.errorMessage;
  if (record.error !== undefined && record.error !== value) return rawErrorMessage(record.error);
  return value;
}

/** Match Mastra's error-chunk shapes while keeping diagnostic redaction intact. */
export function extractSafeErrorMessage(value: unknown, fallback = "The operation failed."): string {
  const sanitized = sanitizeDiagnosticValue(rawErrorMessage(value));
  if (typeof sanitized === "string" && sanitized.trim()) return sanitized.trim().slice(0, 2_000);
  if (sanitized !== undefined && sanitized !== null) {
    try {
      const serialized = JSON.stringify(sanitized);
      if (serialized && serialized !== "{}") return serialized.slice(0, 2_000);
    } catch {
      // Fall through to the stable user-facing message.
    }
  }
  return fallback;
}
