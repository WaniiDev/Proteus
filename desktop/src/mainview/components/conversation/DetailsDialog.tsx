import type { RuntimeSnapshot } from "../../../shared/contracts";
import { ConversationDialog } from "./ConversationDialog";

const STATUS_WORDS: Record<RuntimeSnapshot["workbench"]["status"], string> = {
  idle: "At rest", active: "Working", waiting: "Needs you", complete: "Done", interrupted: "Stopped", error: "Failed",
};
const AVAILABILITY_WORDS: Record<RuntimeSnapshot["activeWorkspace"]["availability"], string> = {
  ready: "Folder connected", missing: "Folder not found",
};

export function conversationDetails(snapshot: RuntimeSnapshot): Array<{ label: string; value: string; mono?: boolean }> {
  const model = snapshot.models.find((item) => item.id === snapshot.selectedModelId);
  const provider = snapshot.providers.find((item) => item.id === (model?.providerId ?? snapshot.selectedProviderId));
  const usage = snapshot.workbench.tokenUsage;
  const run = snapshot.activeRun?.threadId === snapshot.activeThreadId ? snapshot.activeRun : null;
  return [
    { label: "Status", value: STATUS_WORDS[snapshot.workbench.status] ?? snapshot.workbench.status },
    { label: "Workspace", value: snapshot.activeWorkspace.label },
    { label: "Availability", value: AVAILABILITY_WORDS[snapshot.activeWorkspace.availability] ?? snapshot.activeWorkspace.availability },
    { label: "Provider", value: provider?.name ?? snapshot.selectedProviderId },
    { label: "Model", value: model?.name ?? snapshot.selectedModelId },
    { label: "Prompt tokens", value: usage.promptTokens.toLocaleString() },
    { label: "Completion tokens", value: usage.completionTokens.toLocaleString() },
    { label: "Total tokens", value: usage.totalTokens.toLocaleString() },
    { label: "Conversation id", value: snapshot.activeThreadId ?? "None", mono: true },
    { label: run?.status === "running" ? "Current run id" : "Last run id", value: run?.runId ?? "None yet", mono: true },
  ];
}

export function DetailsDialog({ snapshot, onClose }: { snapshot: RuntimeSnapshot; onClose: () => void }) {
  return <ConversationDialog title="Details" onClose={onClose}>
    <div className="list">
      {conversationDetails(snapshot).map((row) => <div className="list-row" key={row.label}>
        <span className="row-copy"><span className="row-title">{row.label}</span></span>
        <span className={`row-end${row.mono ? " mono" : ""}`} title={row.value}>{row.value}</span>
      </div>)}
    </div>
  </ConversationDialog>;
}
