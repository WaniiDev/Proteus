import { type QueuedDraft } from "../lib/composer-ui";

export function QueuedMessageBubble({ draft, onCancel }: { draft: QueuedDraft; onCancel?: (id: string) => void }) {
  return (
    <div className="turn-user turn-queued" data-queued-state={draft.state}>
      <div className="bubble bubble-queued">{draft.text}</div>
      <div className="queued-meta">
        <span className="queued-label">{draft.state === "sending" ? "Sending" : "Queued"}</span>
        {onCancel && draft.state === "queued" && <button type="button" className="btn btn-ghost sm turn-action" onClick={() => onCancel(draft.id)}>Cancel</button>}
      </div>
    </div>
  );
}
