import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  memoryCategories,
  type MemoryCategory,
  type MemoryEntry,
  type MemoryScope,
  type MemorySettingsState,
} from "../../shared/contracts";
import { Modal } from "./ds/Modal";
import { Segmented } from "./ds/Segmented";
import { Select } from "./ds/Select";

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  profile: "Profile",
  preference: "Preferences",
  "work-style": "Work style",
  goal: "Goals",
  "project-context": "Project context",
  decision: "Decisions",
};

/** Up to this many spaces fit a Segmented; more use a Select. */
const SEGMENTED_MAX = 4;

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
    if (!selected || !state.enabled || busy || !content.trim()) return;
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

  const scopeLine = (scope: MemorySettingsState["scopes"][number]) => scope.scope.kind === "global" ? "All workspaces" : scope.status === "archived" ? "Archived project" : "Project only";
  const name = selected?.label ?? "this space";
  const note = !state.enabled
    ? "Memory is paused. Turn it on to save."
    : editing
      ? `Editing in ${name} · ${content.length}/500`
      : `Saves to ${name}${content ? ` · ${content.length}/500` : ". Press Enter to save."}`;

  return <div className="list-stack memory-surface" aria-busy={busy}>
    <div className="list-group">
      <div className="list">
        <label className="list-row switch">
          <span className="switch-copy">
            <strong>{state.enabled ? "Memory is on" : "Memory is paused"}</strong>
            <small>{state.enabled ? "Proteus can reuse what you save here." : "Nothing is read or saved until you turn it back on."}</small>
          </span>
          <input type="checkbox" checked={state.enabled} disabled={busy} onChange={(event) => void onSetEnabled(event.target.checked)} />
          <span className="switch-track" aria-hidden="true" />
        </label>
      </div>
    </div>

    {error && <p className="field-error" role="alert">{error}</p>}

    {selected && <>
      <div className="list-group">
        {state.scopes.length > 1 && (state.scopes.length <= SEGMENTED_MAX
          ? <Segmented label="Memory space" value={selected.key} onChange={selectScope} options={state.scopes.map((scope) => ({ value: scope.key, label: scope.label }))} />
          : <Select
              label="Memory spaces"
              value={selected.key}
              onChange={selectScope}
              triggerLabel={(option) => `Memory space: ${option.name}. Choose a space.`}
              options={state.scopes.map((scope) => ({ value: scope.key, name: scope.label, how: `${scopeLine(scope)} · ${scope.entries.length}` }))}
            />)}
        <div className="list">
          <form className="list-row row-compose" onSubmit={submit}>
            <input
              className="row-input"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={500}
              placeholder="Remember that…"
              aria-label={`Something for Proteus to remember in ${name}`}
              disabled={!state.enabled}
            />
            <select className="row-select" value={category} onChange={(event) => setCategory(event.target.value as MemoryCategory)} aria-label="Category" disabled={!state.enabled}>
              {memoryCategories.map((item) => <option value={item} key={item}>{CATEGORY_LABELS[item]}</option>)}
            </select>
            {editing && <button className="btn btn-ghost sm" type="button" onClick={cancelEdit}>Cancel</button>}
            <button className="btn btn-primary sm" type="submit" disabled={busy || !state.enabled || !content.trim()}>{editing ? "Save changes" : "Save"}</button>
          </form>
        </div>
        <p className="list-note">{note}</p>
      </div>

      {groupedEntries.map((group) => <div className="list-group" key={group.category}>
        <span className="list-label kicker">{CATEGORY_LABELS[group.category]}</span>
        <div className="list">{group.entries.map((entry) => <div className="list-row" key={entry.id}>
          <span className="row-copy"><span className="row-title wrap">{entry.content}</span></span>
          <span className="row-end">
            <button className="btn btn-ghost sm" type="button" disabled={busy} aria-label={`Edit ${entry.content}`} onClick={() => beginEdit(entry)}>Edit</button>
            <button className="btn btn-danger-ghost sm" type="button" disabled={busy} aria-label={`Forget ${entry.content}`} onClick={() => setPendingRemoval({ kind: "entry", entry })}>Forget</button>
          </span>
        </div>)}</div>
      </div>)}

      {selected.entries.length === 0 && <div className="list"><div className="list-row quiet">Nothing saved in {name} yet. Add only what you want Proteus to reuse.</div></div>}

      {selected.entries.length > 0 && <div className="list-group">
        <div className="list"><button className="list-row danger" type="button" disabled={busy} onClick={() => setPendingRemoval({ kind: "scope" })}>Clear {name}</button></div>
      </div>}
    </>}

    {pendingRemoval && <Modal
      title={pendingRemoval.kind === "entry" ? "Forget this?" : "Clear this space?"}
      confirmLabel={pendingRemoval.kind === "entry" ? "Forget" : "Clear space"}
      onCancel={() => setPendingRemoval(null)}
      onConfirm={confirmRemoval}
    >
      {pendingRemoval.kind === "entry" ? "It will no longer be used in future conversations." : `Everything saved in ${name} will be forgotten. Other spaces are not affected.`}
    </Modal>}
  </div>;
}
