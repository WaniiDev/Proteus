import type { ChatEvent, ContinuationState, PendingInteraction, RuntimeSnapshot, TokenUsage, WorkbenchTask, WorkspaceBinding } from "../../shared/contracts";
import type { AppModelSelection } from "../model-preferences";
import type { InteractionToolOutcome, ProjectedToolOutcome } from "../core/runtime-projection";

export type SnapshotListener = (snapshot: RuntimeSnapshot) => void;
export type MastraMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "signal";
  type?: string;
  createdAt: Date;
  content?: unknown;
  metadata?: { signal?: { type?: string } };
};

export type PersistedThreadState = {
  workspaceBinding?: WorkspaceBinding;
  goal?: string;
  tasks?: WorkbenchTask[];
  pendingInteractions?: PendingInteraction[];
  resolvedInteractions?: PendingInteraction[];
  events?: ChatEvent[];
  tokenUsage?: TokenUsage;
  toolOutcomes?: Record<string, ProjectedToolOutcome>;
  modelSelection?: AppModelSelection;
  continuation?: ContinuationState | null;
};

export type InteractionResolution = {
  interaction: PendingInteraction;
  status: Extract<PendingInteraction["status"], "approved" | "rejected" | "answered">;
  feedback?: string;
  terminalEvidence?: InteractionToolOutcome;
};
