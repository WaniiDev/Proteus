import { useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";
import type { ThreadSummary } from "../../shared/contracts";

export function DeleteThreadModal({ thread, onCancel, onConfirm }: { thread: ThreadSummary; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const active = document.activeElement;
      if (event.shiftKey && active === cancelRef.current) {
        event.preventDefault();
        confirmRef.current?.focus();
      } else if (!event.shiftKey && active === confirmRef.current) {
        event.preventDefault();
        cancelRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-conversation-title" aria-describedby="delete-conversation-copy">
        <div className="modal-icon">
          <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <h2 id="delete-conversation-title">Delete conversation?</h2>
        <p id="delete-conversation-copy">
          <strong>{thread.title}</strong> will be removed from this device. This cannot be undone.
        </p>
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="btn-outline sm" onClick={onCancel}>
            Cancel
          </button>
          <button ref={confirmRef} type="button" className="btn-danger sm" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
