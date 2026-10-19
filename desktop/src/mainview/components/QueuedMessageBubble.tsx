import { type QueuedDraft } from "../lib/composer-ui";

export function QueuedMessageBubble({ draft }: { draft: QueuedDraft }) {
  return (
    <div className="msg user queued-message" data-queued-state={draft.state}>
      <div className="bubble"><span>{draft.text}</span></div>
      <div className="queued-message-meta">
        <span className="queued-badge">{draft.state === "sending" ? "Sending" : "Queued"}</span>
      </div>
    </div>
  );
}
