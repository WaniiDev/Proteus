import type { PendingInteraction } from "../shared/contracts";

export type InteractionSubmissionAction = "approve" | "reject" | "answer" | null;

export function interactionSubmissionUi(kind: PendingInteraction["kind"], status: PendingInteraction["status"], action: InteractionSubmissionAction) {
  const activeAction = status === "pending" ? action : null;
  const resolving = status === "resolving" || activeAction !== null;
  const isPlan = kind === "submit_plan";
  const isApproval = kind === "tool_approval";
  return {
    resolving,
    kicker:
      activeAction === "approve"
        ? isPlan ? "Approving plan…" : isApproval ? "Approving tool…" : "Sending response…"
        : activeAction === "reject"
          ? isPlan ? "Sending requested changes…" : isApproval ? "Declining tool…" : "Sending response…"
          : activeAction === "answer"
            ? "Sending answer…"
            : status === "resolving"
              ? isApproval ? "Applying tool decision…" : "Sending response…"
              : null,
    approveLabel: activeAction === "approve" ? "Approving…" : isPlan ? "Approve plan" : isApproval ? "Approve tool" : "Send answer",
    rejectLabel: activeAction === "reject" ? (isPlan ? "Sending changes…" : "Declining…") : isPlan ? "Request changes" : isApproval ? "Decline" : "Cancel",
  };
}
