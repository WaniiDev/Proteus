import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Archive, Brain, Check, FolderOpen, Globe2, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import {
  memoryCategories,
  type MemoryCategory,
  type MemoryEntry,
  type MemoryScope,
  type MemorySettingsState,
} from "../shared/contracts";

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  profile: "Profile",
  preference: "Preferences",
  "work-style": "Work style",
  goal: "Goals",
  "project-context": "Project context",
  decision: "Decisions",
};

type PendingRemoval = { kind: "entry"; entry: MemoryEntry } | { kind: "scope" };

type MemorySettingsSurfaceProps = {
  state: MemorySettingsState;
  focusKey: string;
  busy: boolean;
  error: string | null;
  onSetEnabled: (enabled: boolean) => Promise<boolean>;
  onCreate: (scope: MemoryScope, category: MemoryCategory, content: string) => Promise<boolean>;
  onUpdate: (scope: MemoryScope, id: string, category: MemoryCategory, content: string) => Promise<boolean>;
  onDelete: (scope: MemoryScope, id: string) => Promise<boolean>;
  onReset: (scope: MemoryScope) => Promise<boolean>;
};

export function MemorySettingsSurface({ state, focusKey, busy, error, onSetEnabled, onCreate, onUpdate, onDelete, onReset }: MemorySettingsSurfaceProps) {
  const [selectedKey, setSelectedKey] = useState(focusKey);
  const [category, setCategory] = useState<MemoryCategory>("preference");
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState<MemoryEntry | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);

  useEffect(() => setSelectedKey(focusKey), [focusKey]);
  const selected = state.scopes.find((scope) => scope.key === selectedKey) ?? state.scopes[0];
  const totalEntries = state.scopes.reduce((total, scope) => total + scope.entries.length, 0);
  useEffect(() => {
    if (!state.scopes.some((scope) => scope.key === selectedKey) && state.scopes[0]) {
      setSelectedKey(state.scopes[0].key);
    }
  }, [selectedKey, state]);
  const groupedEntries = useMemo(() => memoryCategories.map((name) => ({
    category: name,
    entries: selected?.entries.filter((entry) => entry.category === name) ?? [],
  })).filter((group) => group.entries.length > 0), [selected]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !content.trim()) return;
    const nextContent = content.trim();
    void (editing
      ? onUpdate(selected.scope, editing.id, category, nextContent)
      : onCreate(selected.scope, category, nextContent))
      .then((saved) => { if (saved) { setContent(""); setEditing(null); } });
  };

  const beginEdit = (entry: MemoryEntry) => {
    setEditing(entry);
    setCategory(entry.category);
    setContent(entry.content);
  };
  const cancelEdit = () => { setEditing(null); setContent(""); };
  const selectScope = (key: string) => {
    setSelectedKey(key);
    cancelEdit();
  };
  const confirmRemoval = () => {
    if (!selected || !pendingRemoval) return;
    const operation = pendingRemoval.kind === "entry"
      ? () => onDelete(selected.scope, pendingRemoval.entry.id)
      : () => onReset(selected.scope);
    setPendingRemoval(null);
    void operation();
  };

  return <section className={`memory-control${state.enabled ? "" : " memory-control--paused"}`} aria-busy={busy}>
    <header className="memory-control__header">
      <div className="memory-control__heading">
        <span className="settings-eyebrow">Your context, under your control</span>
        <h2>Memory</h2>
        <p>Save the few details Proteus should carry into future conversations. Existing chats are never changed.</p>
      </div>
      <label className="memory-master-switch">
        <span className="memory-master-switch__copy">
          <strong>{state.enabled ? "Memory is on" : "Memory is paused"}</strong>
          <small>{state.enabled ? "Saved context can be used in new chats" : "Saved items stay here, but are not used"}</small>
        </span>
        <input type="checkbox" checked={state.enabled} disabled={busy} onChange={(event) => void onSetEnabled(event.target.checked)} />
        <span className="memory-master-switch__track" aria-hidden="true" />
      </label>
    </header>

    <div className="memory-control__trust">
      <ShieldCheck size={18} />
      <div><strong>Nothing is learned silently.</strong><span> Every saved item stays visible, editable, and removable.</span></div>
      <span className="memory-control__count">{totalEntries} {totalEntries === 1 ? "item" : "items"} saved</span>
    </div>

    {error && <p className="memory-control__error" role="alert">{error}</p>}

    <nav className="memory-scope-tabs" aria-label="Memory spaces">
      {state.scopes.map((scope) => {
        const active = scope.key === selected?.key;
        const ScopeIcon = scope.scope.kind === "global" ? Globe2 : scope.status === "archived" ? Archive : FolderOpen;
        return <button type="button" aria-pressed={active} key={scope.key} className={active ? "active" : ""} onClick={() => selectScope(scope.key)}>
          <span className="memory-scope-tabs__icon"><ScopeIcon size={16} /></span>
          <span className="memory-scope-tabs__copy"><strong>{scope.label}</strong><small>{scope.scope.kind === "global" ? "All workspaces" : scope.status === "archived" ? "Archived project" : "Project only"}</small></span>
          <span className="memory-scope-tabs__count">{scope.entries.length}</span>
          {active && <Check className="memory-scope-tabs__check" size={13} aria-hidden="true" />}
        </button>;
      })}
    </nav>

    {selected && <div className="memory-library">
      <header className="memory-library__header">
        <div>
          <span className="settings-eyebrow">{selected.scope.kind === "global" ? "Global memory" : selected.status === "archived" ? "Archived project" : "Project memory"}</span>
          <h3>{selected.label}</h3>
          <p>{selected.scope.kind === "global" ? "Available to future conversations in every workspace." : "Available only to future chats attached to this project."}</p>
        </div>
        {selected.entries.length > 0 && <button className="btn-danger-ghost" type="button" disabled={busy} onClick={() => setPendingRemoval({ kind: "scope" })}>Clear this space</button>}
      </header>

      <form className={`memory-capture${editing ? " memory-capture--editing" : ""}`} onSubmit={submit}>
        <div className="memory-capture__intro">
          <span className="memory-capture__mark"><Plus size={16} /></span>
          <div><strong>{editing ? "Update this memory" : "Save something for later"}</strong><small>Keep it specific, durable, and useful across conversations.</small></div>
          {editing && <button type="button" onClick={cancelEdit} aria-label="Cancel editing"><X size={16} /></button>}
        </div>
        <div className="memory-capture__fields">
          <label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value as MemoryCategory)} aria-label="Memory category">{memoryCategories.map((item) => <option value={item} key={item}>{CATEGORY_LABELS[item]}</option>)}</select></label>
          <label><span>What should Proteus remember?</span><textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={500} rows={3} placeholder="For example: Keep status updates concise and lead with blockers." aria-label="Memory content" /></label>
        </div>
        <div className="memory-capture__actions"><small>{content.length}/500</small><button className="btn-primary sm" type="submit" disabled={busy || !content.trim()}>{editing ? "Save changes" : "Save memory"}</button></div>
      </form>

      <div className="memory-library__content">
        <div className="memory-library__title"><strong>Saved context</strong><span>{selected.entries.length}</span></div>
        {groupedEntries.map((group) => <section className="memory-group" key={group.category}>
          <h4>{CATEGORY_LABELS[group.category]} <span>{group.entries.length}</span></h4>
          <div className="memory-group__items">{group.entries.map((entry) => <article className={`memory-item${editing?.id === entry.id ? " memory-item--editing" : ""}`} key={entry.id}>
            <p>{entry.content}</p>
            <footer>
              <time dateTime={entry.updatedAt}>Updated {new Date(entry.updatedAt).toLocaleDateString()}</time>
              <span>
                <button type="button" disabled={busy} aria-label={`Edit ${entry.content}`} onClick={() => beginEdit(entry)}><Pencil size={14} /></button>
                <button type="button" disabled={busy} aria-label={`Delete ${entry.content}`} onClick={() => setPendingRemoval({ kind: "entry", entry })}><Trash2 size={14} /></button>
              </span>
            </footer>
          </article>)}</div>
        </section>)}
        {selected.entries.length === 0 && <div className="memory-library__empty">
          <span><Brain size={22} /></span><strong>This space is clear</strong><p>Add only the context you deliberately want Proteus to reuse.</p>
        </div>}
      </div>
    </div>}

    {pendingRemoval && <div className="modal-backdrop" role="presentation">
      <section className="modal-card memory-removal-dialog" role="dialog" aria-modal="true" aria-labelledby="memory-removal-title">
        <span className="caption-uppercase">Memory control</span>
        <h2 id="memory-removal-title">{pendingRemoval.kind === "entry" ? "Delete this memory?" : `Clear ${selected?.label ?? "this memory"}?`}</h2>
        <p>{pendingRemoval.kind === "entry" ? "This removes the selected saved item from future conversations." : "This removes every saved item in this space. Other project and global memory stays unchanged."}</p>
        <div className="modal-actions"><button className="btn-outline" type="button" onClick={() => setPendingRemoval(null)}>Cancel</button><button className="btn-danger" type="button" onClick={confirmRemoval}>Delete</button></div>
      </section>
    </div>}
  </section>;
}
