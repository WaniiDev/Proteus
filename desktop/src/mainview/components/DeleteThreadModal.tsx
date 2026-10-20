import type { ThreadSummary } from "../../shared/contracts";
import { Modal } from "./ds/Modal";

export function DeleteThreadModal({ thread, onCancel, onConfirm }: { thread: ThreadSummary; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal title="Delete conversation?" confirmLabel="Delete" onCancel={onCancel} onConfirm={onConfirm}>
      <span className="modal-name">“{thread.title}”</span> will be removed from this device. Files it changed stay as they are. This can’t be undone.
    </Modal>
  );
}
