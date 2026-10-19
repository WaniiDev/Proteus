import { useMemo, useState } from "react";
import type { PendingInteraction } from "../../shared/contracts";

/** @deprecated Approval interactions render through InteractionCard. */
export function ToolApprovalCard({ approval, onRespond }: { approval: PendingInteraction; onRespond: (toolCallId: string, approved: boolean) => Promise<boolean> }) {
  const [decision, setDecision] = useState<"approve" | "decline" | null>(null);
  const resolving = decision !== null;
  const args = useMemo(() => {
    try {
      return JSON.stringify(approval.args ?? null, null, 2);
    } catch {
      return "Unable to display tool arguments.";
    }
  }, [approval.args]);
  const respond = (approved: boolean) => {
    if (resolving) return;
    setDecision(approved ? "approve" : "decline");
    void onRespond(approval.toolCallId, approved)
      .then((accepted) => {
        if (!accepted) setDecision(null);
      })
      .catch(() => setDecision(null));
  };
  return (
    <article className={`interaction-card tool-approval-card${resolving ? " resolving" : ""}`} id={`tool-approval-${approval.toolCallId}`}>
      <div className="interaction-kicker">{decision === "approve" ? "Approving tool…" : decision === "decline" ? "Declining tool…" : "Approval required"}</div>
      <h3>Allow {approval.toolName ?? "tool"}?</h3>
      <p>Proteus is ready to use this tool. Review the request before it continues.</p>
      {approval.toolName === "mastra_workspace_execute_command" && <p className="tool-approval-warning">This command runs directly on your Windows computer from this chat’s workspace. Mastra LocalSandbox does not provide OS isolation on Windows.</p>}
      <pre className="tool-approval-args">{args}</pre>
      <div className="interaction-actions">
        <button disabled={resolving} type="button" className="btn-outline sm" onClick={() => respond(false)}>
          {decision === "decline" ? "Declining…" : "Decline"}
        </button>
        <button disabled={resolving} type="button" className="btn-primary sm" onClick={() => respond(true)}>
          {decision === "approve" ? "Approving…" : "Approve"}
        </button>
      </div>
    </article>
  );
}
