import { useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeSnapshot, ThreadSummary } from "../../shared/contracts";
import { groupThreads, relativeTime } from "../lib/ui-helpers";
import { Icon } from "./Icon";

/** @deprecated Conversation navigation now lives in the persistent sidebar. */
export function ConversationPopover({ snapshot, open, disabled, initialEditingId, onClose, onCreate, onSwitch, onRename, onDelete }: { snapshot: RuntimeSnapshot; open: boolean; disabled: boolean; initialEditingId?: string | null; onClose: () => void; onCreate: () => void; onSwitch: (threadId: string) => void; onRename: (threadId: string, title: string) => void; onDelete: (thread: ThreadSummary) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const groups = useMemo(() => groupThreads(snapshot.threads, query), [query, snapshot.threads]);
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);
  useEffect(() => {
    if (!open || !initialEditingId) return;
    const thread = snapshot.threads.find((item) => item.id === initialEditingId);
    if (thread && !disabled) {
      setEditingId(thread.id);
      setEditValue(thread.title);
    }
  }, [disabled, initialEditingId, open, snapshot.threads]);
  if (!open) return null;
  const beginEdit = (thread: ThreadSummary) => {
    if (disabled) return;
    setEditingId(thread.id);
    setEditValue(thread.title);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };
  const saveEdit = (thread: ThreadSummary) => {
    const next = editValue.trim().slice(0, 80);
    if (next && next !== thread.title) onRename(thread.id, next);
    cancelEdit();
  };
  return (
    <div className="conversation-popover" ref={rootRef} role="dialog" aria-label="Conversation history">
      <div className="conversation-popover-head">
        <div>
          <span className="caption-uppercase">Conversations</span>
          <p>Saved on this device</p>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => {
            onCreate();
            onClose();
          }}
          disabled={disabled}
          aria-label="New chat"
          title={disabled ? "Available when the current response finishes" : "New chat"}
        >
          <Icon name="plus" size={17} />
        </button>
      </div>
      <label className="conversation-search">
        <Icon name="search" size={15} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
      </label>
      <div className="conversation-popover-list">
        {groups.length === 0 ? (
          <p className="conversation-empty">{snapshot.threads.length === 0 ? "Your first chat will appear here." : "No conversations match your search."}</p>
        ) : (
          groups.map((group) => (
            <section key={group.name} className="conversation-group">
              <h3>{group.name}</h3>
              {group.threads.map((thread) => (
                <div className={`conversation-row${thread.id === snapshot.activeThreadId ? " active" : ""}`} key={thread.id}>
                  {editingId === thread.id ? (
                    <form
                      className="conversation-edit"
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveEdit(thread);
                      }}
                    >
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(event) => setEditValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelEdit();
                          }
                        }}
                        aria-label={`Rename ${thread.title}`}
                      />
                      <button type="submit" className="row-icon-action" aria-label="Save conversation name">
                        <Icon name="check" size={14} />
                      </button>
                      <button type="button" className="row-icon-action" onClick={cancelEdit} aria-label="Cancel rename">
                        <Icon name="close" size={14} />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="conversation-select"
                        onClick={() => {
                          onSwitch(thread.id);
                          onClose();
                        }}
                      >
                        <span className={`thread-activity ${thread.activity}`} aria-hidden="true" />
                        <span className="conversation-row-copy">
                          <b>{thread.title}</b>
                          <small>{thread.attention > 0 ? `${thread.attention} waiting` : relativeTime(thread.updatedAt)}</small>
                        </span>
                      </button>
                      <span className="conversation-row-actions">
                        <button type="button" className="row-icon-action" onClick={() => beginEdit(thread)} disabled={disabled} aria-label={`Rename ${thread.title}`} title={disabled ? "Available when the current response finishes" : "Rename"}>
                          <Icon name="edit" size={14} />
                        </button>
                        <button type="button" className="row-icon-action danger" onClick={() => onDelete(thread)} disabled={disabled} aria-label={`Delete ${thread.title}`} title={disabled ? "Available when the current response finishes" : "Delete"}>
                          <Icon name="trash" size={14} />
                        </button>
                      </span>
                    </>
                  )}
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
