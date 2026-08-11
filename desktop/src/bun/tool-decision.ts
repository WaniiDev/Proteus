export const MASTRA_TOOL_DECLINED_MESSAGE = "Tool call was not approved by the user";

function outputText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const candidate of [record.content, record.message, record.error]) {
    if (typeof candidate === "string") return candidate;
  }
  return null;
}

/** Normalize every denial shape emitted by the installed Mastra UI projection. */
export function isDeclinedToolResult(input: { state?: unknown; status?: unknown; approval?: unknown; output?: unknown }): boolean {
  const state = String(input.state ?? input.status ?? "").toLowerCase();
  if (state === "output-denied" || /denied|declined/.test(state)) return true;
  if (input.approval && typeof input.approval === "object" && (input.approval as { approved?: unknown }).approved === false) return true;
  return outputText(input.output)?.trim() === MASTRA_TOOL_DECLINED_MESSAGE;
}
