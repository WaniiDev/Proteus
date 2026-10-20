import type { PendingInteraction } from "../../shared/contracts";

export type InteractionSubmissionAction = "approve" | "reject" | "answer" | null;

export function interactionSubmissionUi(kind: PendingInteraction["kind"], status: PendingInteraction["status"], action: InteractionSubmissionAction, approveLabel?: string) {
  const activeAction = status === "pending" ? action : null;
  const resolving = status === "resolving" || activeAction !== null;
  const isPlan = kind === "submit_plan";
  const isApproval = kind === "tool_approval";
  // The pressed button (spinner + participle) is the only busy signal; there is no extra line.
  return {
    resolving,
    approveLabel: activeAction === "approve" ? "Approving…" : activeAction === "answer" ? "Answering…" : isPlan ? "Approve plan" : isApproval ? (approveLabel ?? "Approve") : "Answer",
    rejectLabel: activeAction === "reject" ? (isPlan ? "Sending changes…" : "Declining…") : isPlan ? "Request changes" : isApproval ? "Decline" : "",
  };
}
