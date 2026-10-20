import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Brain, Copy, FolderOpen, MoreHorizontal, Pencil, Pin, PinOff, Plus, SlidersHorizontal, Trash2, type LucideIcon } from "lucide-react";
import type { ChatMessage, ThreadSummary } from "../../shared/contracts";
import { groupSessions, relativeTime } from "../lib/ui-helpers";
import { Menu, MenuItem, MenuRule } from "./ds/Menu";

export type View = "companion" | "projects" | "settings";

type SidebarProps = {
  view: View;
  /** Which settings tab is showing, so Memory and Settings can tell which one is current. */
  settingsSection?: string;
  disabled: boolean;
  onView: (view: View) => void;
  onMemory?: () => void;
  onSettings?: () => void;
  onCreate: () => void;
  threads?: ThreadSummary[];
  activeThreadId?: string | null;
  /** Transcript of the active conversation only; other conversations' messages are not in the renderer. */
  messages?: ChatMessage[];
  onSwitch?: (threadId: string) => void;
  onRename?: (threadId: string, title: string) => void;
  onPin?: (threadId: string, pinned: boolean) => void;
  onDeleteRequest?: (thread: ThreadSummary) => void;
};

const STATUS: Partial<Record<ThreadSummary["activity"], { word: string; cls: string; dot: string }>> = {
  running: { word: "Working", cls: "is-run", dot: "dot run" },
  waiting: { word: "Needs you", cls: "is-warn", dot: "dot warn" },
  error: { word: "Failed", cls: "is-err", dot: "dot err" },
  interrupted: { word: "Stopped", cls: "", dot: "dot" },
};

export function transcriptText(messages: ChatMessage[]): string {
  return messages.filter((message) => message.text.trim()).map((message) => `${message.role === "user" ? "You" : "Proteus"}: ${message.text.trim()}`).join("\n\n");
}

function Destination({ icon: Glyph, label, current, onClick }: { icon: LucideIcon; label: string; current: boolean; onClick: () => void }) {
  return <button type="button" className="nav-item" aria-current={current ? "page" : undefined} onClick={onClick}><Glyph className="i" aria-hidden="true" />{label}</button>;
}

function RenameField({ initial, label, onCommit, onCancel }: { initial: string; label: string; onCommit: (title: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const commit = () => { if (done.current) return; done.current = true; onCommit(ref.current?.value ?? initial); };
  const cancel = () => { if (done.current) return; done.current = true; onCancel(); };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") { event.preventDefault(); commit(); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); }
  };
  // Chrome fires blur when the field is removed; by then Enter or Escape has already settled it.
  const onBlur = (event: { currentTarget: HTMLInputElement }) => { if (event.currentTarget.isConnected) commit(); };
  return <input ref={ref} className="session-rename" aria-label={label} defaultValue={initial} maxLength={120} onKeyDown={onKeyDown} onBlur={onBlur} />;
}

export function Sidebar({ view, settingsSection, disabled, onView, onMemory, onSettings, onCreate, threads = [], activeThreadId, messages = [], onSwitch, onRename, onPin, onDeleteRequest }: SidebarProps) {
  const [menu, setMenu] = useState<{ threadId: string; anchor: HTMLButtonElement } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const groups = useMemo(() => groupSessions(threads), [threads]);
  const menuThread = menu ? threads.find((thread) => thread.id === menu.threadId) : undefined;

  useEffect(() => { if (menu && !menuThread) setMenu(null); }, [menu, menuThread]);

  const commitRename = (thread: ThreadSummary, raw: string) => {
    const next = raw.trim();
    setEditingId(null);
    if (next && next !== thread.title) onRename?.(thread.id, next);
  };
  const copyTranscript = () => { void navigator.clipboard?.writeText(transcriptText(messages)).catch(() => undefined); };
  const memoryCurrent = view === "settings" && settingsSection === "memory";

  return <aside className="sidebar app-sidebar" aria-label="Main">
    <button type="button" className="btn btn-glass block" onClick={onCreate} disabled={disabled} title={disabled ? "Available when the current response finishes" : undefined}><Plus className="i" aria-hidden="true" />New chat</button>
    <div className="sidebar-scroll">
      {groups.length === 0 && <p className="field-hint">Your conversations will appear here.</p>}
      {groups.map((group) => <div className="sidebar-group" role="group" aria-label={group.name} key={group.name}>
        <span className="kicker">{group.name}</span>
        {group.threads.map((thread) => {
          const current = view === "companion" && thread.id === activeThreadId;
          const status = STATUS[thread.activity];
          const editing = editingId === thread.id;
          return <div className={`session${menu?.threadId === thread.id ? " is-menu" : ""}`} aria-current={current ? "page" : undefined} key={thread.id}>
            {editing
              ? <div className="session-main"><span className="session-mark" aria-hidden="true" /><RenameField initial={thread.title} label="Rename conversation" onCommit={(title) => commitRename(thread, title)} onCancel={() => setEditingId(null)} /></div>
              : <button type="button" className="session-main" title={thread.title} onClick={() => { onSwitch?.(thread.id); onView("companion"); }}>
                <span className={`session-mark ${status?.dot ?? ""}`.trim()} aria-hidden="true" />
                <span className="session-title">{thread.title}</span>
                <span className="session-meta">
                  {status && <><span className={status.cls || undefined}><span key={status.word}>{status.word}</span></span><span aria-hidden="true">·</span></>}
                  {thread.pinned && <Pin className="i sm" aria-label="Pinned" />}
                  <span>{[thread.workspace.label, relativeTime(thread.updatedAt)].filter(Boolean).join(" · ")}</span>
                </span>
              </button>}
            {!editing && <button type="button" className="session-more" aria-label={`Actions for ${thread.title}`} title="Conversation actions" aria-haspopup="menu" aria-expanded={menu?.threadId === thread.id} onClick={(event) => { const anchor = event.currentTarget; setMenu((open) => open?.threadId === thread.id ? null : { threadId: thread.id, anchor }); }}><MoreHorizontal className="i" aria-hidden="true" /></button>}
          </div>;
        })}
      </div>)}
    </div>
    <div className="sidebar-foot">
      <Destination icon={FolderOpen} label="Projects" current={view === "projects"} onClick={() => onView("projects")} />
      <Destination icon={Brain} label="Memory" current={memoryCurrent} onClick={() => (onMemory ?? (() => onView("settings")))()} />
      <Destination icon={SlidersHorizontal} label="Settings" current={view === "settings" && !memoryCurrent} onClick={() => (onSettings ?? (() => onView("settings")))()} />
    </div>
    {menu && menuThread && <Menu key={menu.threadId} className="session-menu" label={`Actions for ${menuThread.title}`} anchor={menu.anchor} onClose={() => setMenu(null)}>
      <MenuItem icon={<Pencil className="i sm" aria-hidden="true" />} onSelect={() => setEditingId(menuThread.id)}>Rename</MenuItem>
      <MenuItem icon={menuThread.pinned ? <PinOff className="i sm" aria-hidden="true" /> : <Pin className="i sm" aria-hidden="true" />} onSelect={() => onPin?.(menuThread.id, !menuThread.pinned)}>{menuThread.pinned ? "Unpin" : "Pin to top"}</MenuItem>
      <MenuItem icon={<Copy className="i sm" aria-hidden="true" />} disabled={menuThread.id !== activeThreadId} reason="Open it first" onSelect={copyTranscript}>Copy transcript</MenuItem>
      <MenuRule />
      <MenuItem danger icon={<Trash2 className="i sm" aria-hidden="true" />} onSelect={() => onDeleteRequest?.(menuThread)}>Delete…</MenuItem>
    </Menu>}
  </aside>;
}
