import { useEffect, useRef, useState, type FormEvent } from "react";
import { ConversationDialog } from "./ConversationDialog";

// The header's Rename: a small field in the conversation dialog (the sidebar renames in place on its own row).
export function RenameDialog({ title, onSave, onClose }: { title: string; onSave: (title: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(title);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const next = value.trim();
  const changed = next !== "" && next !== title;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!changed) return;
    onSave(next);
    onClose();
  };
  return <ConversationDialog title="Rename conversation" onClose={onClose}>
    <form onSubmit={submit} className="conversation-rename">
      <input ref={ref} className="input" aria-label="Conversation name" value={value} maxLength={120} onChange={(event) => setValue(event.target.value)} />
      <div><button type="submit" className="btn btn-primary sm" disabled={!changed}>Save</button></div>
    </form>
  </ConversationDialog>;
}
