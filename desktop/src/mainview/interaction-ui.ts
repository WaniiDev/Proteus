import type { PendingInteraction } from "../shared/contracts";

export type InteractionSubmissionAction = "approve" | "reject" | "answer" | null;

export function interactionSubmissionUi(status: PendingInteraction["status"], action: InteractionSubmissionAction) {
  const activeAction = status === "pending" ? action : null;
  const resolving = status === "resolving" || activeAction !== null;
  return {
    resolving,
    kicker:
      activeAction === "approve"
        ? "Approving plan…"
        : activeAction === "reject"
          ? "Sending requested changes…"
          : activeAction === "answer"
            ? "Sending answer…"
            : status === "resolving"
              ? "Sending response…"
              : null,
    approveLabel: activeAction === "approve" ? "Approving…" : "Approve plan",
    rejectLabel: activeAction === "reject" ? "Sending changes…" : "Request changes",
  };
}
