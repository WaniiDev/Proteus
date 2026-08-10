import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Brain, Check, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import {
  memoryCategories,
  type MemoryCategory,
  type MemoryEntry,
  type MemoryScope,
  type MemorySettingsState,
} from "../shared/contracts";
import { rpc } from "./bridge";

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  profile: "Profile",
  preference: "Preferences",
  "work-style": "Work style",
  goal: "Goals",
  "project-context": "Project context",
  decision: "Decisions",
};

type PendingRemoval = { kind: "entry"; entry: MemoryEntry } | { kind: "scope" };

export function MemorySettingsPanel({ focusScope }: { focusScope?: MemoryScope }) {
  const focusKey = focusScope?.kind === "project" ? `project:${focusScope.projectId}` : "global";
  const [state, setState] = useState<MemorySettingsState | null>(null);
  const [selectedKey, setSelectedKey] = useState(focusKey);
  const [category, setCategory] = useState<MemoryCategory>("preference");
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState<MemoryEntry | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSelectedKey(focusKey), [focusKey]);
  useEffect(() => {
    let active = true;
    setError(null);
    void rpc.request["memory.get"](focusScope ? { scope: focusScope } : undefined)
      .then((next) => { if (active) setState(next); })
      .catch(() => { if (active) setError("Memory settings could not be loaded."); });
    return () => { active = false; };
  }, [focusKey]);

  const selected = state?.scopes.find((scope) => scope.key === selectedKey) ?? state?.scopes[0];
  useEffect(() => {
    if (state && !state.scopes.some((scope) => scope.key === selectedKey) && state.scopes[0]) setSelectedKey(state.scopes[0].key);
  }, [selectedKey, state]);
  const groupedEntries = useMemo(() => memoryCategories.map((name) => ({
    category: name,
    entries: selected?.entries.filter((entry) => entry.category === name) ?? [],
  })).filter((group) => group.entries.length > 0), [selected]);

  const run = async (operation: () => Promise<MemorySettingsState>): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      setState(await operation());
      return true;
    } catch {
      setError("The memory change could not be saved. Nothing was changed.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !content.trim()) return;
    const nextContent = content.trim();
    void run(() => editing
      ? rpc.request["memory.update"]({ scope: selected.scope, id: editing.id, category, content: nextContent })
      : rpc.request["memory.create"]({ scope: selected.scope, category, content: nextContent }))
      .then((saved) => { if (saved) { setContent(""); setEditing(null); } });
  };

  const beginEdit = (entry: MemoryEntry) => {
    setEditing(entry);
    setCategory(entry.category);
    setContent(entry.content);
  };
  const cancelEdit = () => { setEditing(null); setContent(""); };
  const confirmRemoval = () => {
    if (!selected || !pendingRemoval) return;
    const operation = pendingRemoval.kind === "entry"
      ? () => rpc.request["memory.delete"]({ scope: selected.scope, id: pendingRemoval.entry.id })
      : () => rpc.request["memory.reset"]({ scope: selected.scope });
    setPendingRemoval(null);
    void run(operation);
  };

  if (!state && !error) return <section className="card settings-card memory-settings-card"><p className="settings-note">Loading memory…</p></section>;

  return <div className="memory-settings">
    <section className="card settings-card memory-consent-card">
      <div className="settings-section-head">
        <div><span className="settings-eyebrow">Explicit and local</span><h2 className="title-md">Memory</h2><p className="settings-intro">Choose what Proteus may carry into future chats. Existing chats are never rewritten or backfilled.</p></div>
        <label className="memory-enable-control"><input type="checkbox" checked={state?.enabled ?? false} disabled={busy || !state} onChange={(event) => void run(() => rpc.request["memory.set-enabled"]({ enabled: event.target.checked }))} /><span aria-hidden="true" /><strong>{state?.enabled ? "On" : "Off"}</strong></label>
      </div>
      <div className="memory-privacy-note"><ShieldCheck size={17} /><span><strong>Nothing is learned silently.</strong> You can review and edit every saved item here. Proteus asks for approval before an agent deletes memory.</span></div>
    </section>

    {error && <p className="settings-note error" role="alert">{error}</p>}
    {state && <div className="memory-workspace">
      <aside className="memory-scope-list" aria-label="Memory scopes">
        <div className="memory-scope-heading"><strong>Spaces</strong><small>{state.scopes.length}</small></div>
        {state.scopes.map((scope) => <button type="button" key={scope.key} className={scope.key === selected?.key ? "active" : ""} onClick={() => { setSelectedKey(scope.key); cancelEdit(); }}>
          <span className="memory-scope-icon"><Brain size={15} /></span><span><strong>{scope.label}</strong><small>{scope.scope.kind === "global" ? "Every new chat" : scope.status === "archived" ? "Archived project" : `${scope.entries.length} saved`}</small></span>{scope.key === selected?.key && <Check size={15} />}
        </button>)}
      </aside>

      <section className="card memory-editor-card">
        {selected && <>
          <header className="memory-editor-head"><div><span className="settings-eyebrow">{selected.scope.kind === "global" ? "Global memory" : selected.status === "archived" ? "Archived project" : "Project memory"}</span><h2 className="title-md">{selected.label}</h2><p>{selected.scope.kind === "global" ? "Available to future conversations in every workspace." : "Available only to future chats attached to this project."}</p></div>{selected.entries.length > 0 && <button className="btn-danger-ghost" type="button" disabled={busy} onClick={() => setPendingRemoval({ kind: "scope" })}>Clear all</button>}</header>

          <form className="memory-compose" onSubmit={submit}>
            <div className="memory-compose-head"><strong>{editing ? "Edit saved memory" : "Add a memory"}</strong>{editing && <button type="button" onClick={cancelEdit} aria-label="Cancel editing"><X size={15} /></button>}</div>
            <div className="memory-compose-fields"><select value={category} onChange={(event) => setCategory(event.target.value as MemoryCategory)} aria-label="Memory category">{memoryCategories.map((item) => <option value={item} key={item}>{CATEGORY_LABELS[item]}</option>)}</select><textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={500} rows={3} placeholder="A durable fact, preference, goal, or decision…" aria-label="Memory content" /></div>
            <div className="memory-compose-actions"><small>{content.length}/500</small><button className="btn-primary sm" type="submit" disabled={busy || !content.trim()}>{editing ? "Save changes" : <><Plus size={14} /> Add memory</>}</button></div>
          </form>

          <div className="memory-entry-groups">
            {groupedEntries.map((group) => <section key={group.category}><h3>{CATEGORY_LABELS[group.category]} <span>{group.entries.length}</span></h3><div className="memory-entry-list">{group.entries.map((entry) => <article key={entry.id} className={editing?.id === entry.id ? "editing" : ""}><p>{entry.content}</p><footer><time>Updated {new Date(entry.updatedAt).toLocaleDateString()}</time><span><button type="button" aria-label={`Edit ${entry.content}`} onClick={() => beginEdit(entry)}><Pencil size={14} /></button><button type="button" aria-label={`Delete ${entry.content}`} onClick={() => setPendingRemoval({ kind: "entry", entry })}><Trash2 size={14} /></button></span></footer></article>)}</div></section>)}
            {selected.entries.length === 0 && <div className="memory-empty-state"><Brain size={22} /><strong>No saved memory here</strong><p>Add only the context you want Proteus to reuse later.</p></div>}
          </div>
        </>}
      </section>
    </div>}

    {pendingRemoval && <div className="modal-backdrop" role="presentation"><section className="modal-card memory-confirm" role="dialog" aria-modal="true" aria-labelledby="memory-confirm-title"><span className="caption-uppercase">Memory control</span><h2 id="memory-confirm-title">{pendingRemoval.kind === "entry" ? "Delete this memory?" : `Clear ${selected?.label ?? "this memory"}?`}</h2><p>{pendingRemoval.kind === "entry" ? "This removes the selected saved item from future conversations." : "This removes every saved item in this scope. Other project and global memory stays unchanged."}</p><div className="modal-actions"><button className="btn-outline" type="button" onClick={() => setPendingRemoval(null)}>Cancel</button><button className="btn-danger" type="button" onClick={confirmRemoval}>Delete</button></div></section></div>}
  </div>;
}
