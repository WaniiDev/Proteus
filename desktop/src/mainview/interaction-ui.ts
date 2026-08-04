import type { PendingInteraction } from "../shared/contracts";

export type InteractionSubmissionAction = "approve" | "reject" | "answer" | null;

export function interactionSubmissionUi(status: PendingInteraction["status"], action: InteractionSubmissionAction) {
  const resolving = status === "resolving" || action !== null;
  return {
    resolving,
    kicker:
      action === "approve"
        ? "Approving plan…"
        : action === "reject"
          ? "Sending requested changes…"
          : action === "answer"
            ? "Sending answer…"
            : status === "resolving"
              ? "Sending response…"
              : null,
    approveLabel: action === "approve" ? "Approving…" : "Approve plan",
    rejectLabel: action === "reject" ? "Sending changes…" : "Request changes",
  };
}
