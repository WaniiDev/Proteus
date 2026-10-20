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

/**
 * Answer intents (ADR 0003) are a closed set, never tool calls. This is the whole policy for them:
 * how each intent may act, and that only `approve` can reach a write. A write needs the person's own decision on the
 * exact change shown (`explicit-approval`); the model cannot raise an intent, because it is an RPC and not a tool.
 */
export type AnswerIntentGate = "read-only" | "draft-only" | "explicit-approval" | "person-reply" | "record-only";
export const ANSWER_INTENT_GATES: Readonly<Record<"open" | "reply" | "approve" | "choose" | "skip", AnswerIntentGate>> = {
  open: "read-only",
  reply: "draft-only",
  approve: "explicit-approval",
  choose: "person-reply",
  skip: "record-only",
};

/** The approval record for a diff an answer showed: the same fingerprint scheme as an Island approval, over the exact file and lines. */
export function answerWriteFingerprint(file: string, lines: unknown): string {
  return approvalFingerprint("answer_diff_apply", { file, lines });
}
