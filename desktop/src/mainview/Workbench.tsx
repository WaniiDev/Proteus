import { ArrowRight, Check, ChevronDown } from "lucide-react";
import type { RuntimeSnapshot, WorkbenchTask } from "../shared/contracts";
import { goalFromMessages } from "./ui-helpers";

export function Workbench({ snapshot, onJump }: { snapshot: RuntimeSnapshot; onJump: (id: string) => void }) {
  const wb = snapshot.workbench;
  const attentionItems = wb.pendingInteractions.filter((item) => item.status === "pending");
  const totalTokens = wb.tokenUsage.totalTokens;
  const statusLabel = attentionItems.length > 0 ? "Needs you" : wb.status === "complete" ? "Done" : wb.status === "active" ? "Active" : wb.status === "waiting" ? "Waiting" : wb.status === "interrupted" ? "Interrupted" : wb.status === "error" ? "Error" : "Current";

  return (
    <aside className="workbench" aria-label="Conversation Workbench">
      <div className="workbench-live">
        <div className="wb-head">
          <div className="wb-head-main">
            <span className="caption-uppercase">Current work</span>
            <h2>{wb.goal || goalFromMessages(snapshot.messages)}</h2>
          </div>
          <div className="wb-head-actions">
            <span className={`badge-pill wb-status ${wb.status}`}>{statusLabel}</span>
          </div>
        </div>
        <div className="wb-groups">
          {attentionItems.length > 0 && (
            <section className="wb-group wb-attention">
              <div className="wb-group-title">
                <span>Attention required</span>
                <b>{attentionItems.length}</b>
              </div>
              {attentionItems.map((item) => (
                <button type="button" className="wb-link" key={item.id} onClick={() => onJump(item.id)}>
                  {item.kind === "submit_plan" ? "Plan approval" : item.title}
                  <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
                </button>
              ))}
            </section>
          )}
          {wb.tasks.length > 0 && (
            <section className="wb-group">
              <div className="wb-group-title">
                <span>Plan &amp; tasks</span>
                <span>{wb.tasks.filter((task) => task.status === "completed").length}/{wb.tasks.length}</span>
              </div>
              <ul className="wb-steps">
                {wb.tasks.map((task: WorkbenchTask) => (
                  <li key={task.id} className={task.status}>
                    <span className="task-check">
                      {task.status === "completed" ? <Check size={11} strokeWidth={1.75} aria-hidden="true" /> : task.status === "in_progress" ? "•" : ""}
                    </span>
                    <span>{task.status === "in_progress" ? task.activeForm : task.content}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {wb.queuedFollowUpCount > 0 && (
            <section className="wb-group" aria-label="Queued follow-ups">
              <div className="wb-group-title">
                <span>Queued follow-ups</span>
                <b>{wb.queuedFollowUpCount}</b>
              </div>
              <p className="wb-note">Mastra will send {wb.queuedFollowUpCount === 1 ? "this message" : "these messages"} after the current response.</p>
            </section>
          )}
          {totalTokens > 0 && (
            <details className="wb-session">
              <summary>
                <span>Session details</span>
                <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
              </summary>
              <dl>
                <div><dt>Prompt tokens</dt><dd>{wb.tokenUsage.promptTokens.toLocaleString()}</dd></div>
                <div><dt>Completion</dt><dd>{wb.tokenUsage.completionTokens.toLocaleString()}</dd></div>
                <div><dt>Total</dt><dd>{totalTokens.toLocaleString()}</dd></div>
              </dl>
            </details>
          )}
        </div>
      </div>
    </aside>
  );
}
