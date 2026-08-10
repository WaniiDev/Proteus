import type { WorkspaceBindingUpdateResult } from "../shared/contracts";

export type WorkspaceSelectionActivity = {
  runtimeBusy: boolean;
  queuedCount: number;
  storedMessageCount: number;
  hasOptimisticMessage: boolean;
  suspensionCount: number;
  hasPendingInteraction: boolean;
};

type WorkspaceSelectionFailure = Exclude<WorkspaceBindingUpdateResult, { accepted: true }>;

export function workspaceSelectionBlocker(activity: WorkspaceSelectionActivity): WorkspaceSelectionFailure | null {
  if (activity.runtimeBusy || activity.queuedCount > 0) {
    return { accepted: false, code: "busy", message: "Wait for the current conversation activity to finish before changing projects." };
  }
  if (
    activity.storedMessageCount > 0
    || activity.hasOptimisticMessage
    || activity.suspensionCount > 0
    || activity.hasPendingInteraction
  ) {
    return { accepted: false, code: "not-empty", message: "The project can only be changed before the first message." };
  }
  return null;
}
