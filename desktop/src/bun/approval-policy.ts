import { createHash } from "node:crypto";

export const APPROVAL_POLICY_VERSION = 1;

export function stableApprovalValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableApprovalValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableApprovalValue(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/** Bind a review decision to the exact Mastra tool name and arguments shown. */
export function approvalFingerprint(toolName: string, args: unknown): string {
  return createHash("sha256")
    .update(stableApprovalValue({ toolName, args }))
    .digest("hex");
}
