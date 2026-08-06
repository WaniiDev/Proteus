export function toolResultError(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = value as { error?: unknown; isError?: unknown; message?: unknown; content?: unknown };
  if (result.error !== true && result.isError !== true && typeof result.error !== "string") return undefined;
  if (typeof result.message === "string") return result.message;
  if (typeof result.content === "string") return result.content;
  if (typeof result.error === "string") return result.error;
  return "Tool failed.";
}

