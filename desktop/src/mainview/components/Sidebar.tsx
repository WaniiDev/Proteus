import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Brain, Copy, Folder, MoreHorizontal, Pencil, Pin, PinOff, Plus, Settings2, Trash2, type LucideIcon } from "lucide-react";
import type { ChatMessage, ThreadSummary } from "../../shared/contracts";
import { groupSessions, relativeTime } from "../lib/ui-helpers";
import { Menu, MenuItem, MenuRule } from "./ds/Menu";
import { useToast } from "./ds/Toast";

export type View = "companion" | "projects" | "memory" | "settings";

type SidebarProps = {
  view: View;
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

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function enterMs(): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dur-enter"));
  return Number.isFinite(value) && value > 0 ? value : 220;
}

// A deleted conversation keeps its row for --dur-enter as `.session.is-leaving`, so it fades and folds and the rows below
// close the gap (motion.md, Rows), then goes. Returns the threads that are on their way out.
function useLeavingThreads(threads: ThreadSummary[]): ThreadSummary[] {
  const [previous, setPrevious] = useState(threads);
  const [ghosts, setGhosts] = useState<ThreadSummary[]>([]);
  if (previous !== threads) {
    setPrevious(threads);
    const gone = previous.filter((old) => !threads.some((next) => next.id === old.id) && !ghosts.some((ghost) => ghost.id === old.id));
    if (gone.length && !reducedMotion()) setGhosts((current) => [...current, ...gone]);
  }
  const scheduled = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    for (const ghost of ghosts) {
      if (scheduled.current.has(ghost.id)) continue;
      scheduled.current.set(ghost.id, setTimeout(() => {
        scheduled.current.delete(ghost.id);
        setGhosts((current) => current.filter((item) => item.id !== ghost.id));
      }, enterMs()));
    }
  }, [ghosts]);
  useEffect(() => () => { for (const timer of scheduled.current.values()) clearTimeout(timer); scheduled.current.clear(); }, []);
  // A conversation that reappears (same id) is no longer leaving.
  return ghosts.filter((ghost) => !threads.some((thread) => thread.id === ghost.id));
}

export function transcriptText(messages: ChatMessage[]): string {
  return messages.filter((message) => message.text.trim()).map((message) => `${message.role === "user" ? "You" : "Proteus"}: ${message.text.trim()}`).join("\n\n");
}

function Destination({ icon: Glyph, label, current, onClick }: { icon: LucideIcon; label: string; current: boolean; onClick: () => void }) {
  return <button type="button" className="nav-item" aria-current={current ? "page" : undefined} onClick={onClick}><Glyph className="i" aria-hidden="true" />{label}</button>;
}

function RenameField({ initial, label, onCommit, onCancel }: { initial: string; label: string; onCommit: (title: string, byKey: boolean) => void; onCancel: (byKey: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const commit = (byKey: boolean) => { if (done.current) return; done.current = true; onCommit(ref.current?.value ?? initial, byKey); };
  const cancel = () => { if (done.current) return; done.current = true; onCancel(true); };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") { event.preventDefault(); commit(true); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); }
  };
  // Chrome fires blur when the field is removed; by then Enter or Escape has already settled it.
  const onBlur = (event: { currentTarget: HTMLInputElement }) => { if (event.currentTarget.isConnected) commit(false); };
  return <input ref={ref} className="session-rename" aria-label={label} defaultValue={initial} maxLength={120} onKeyDown={onKeyDown} onBlur={onBlur} />;
}

export function Sidebar({ view, disabled, onView, onMemory, onSettings, onCreate, threads = [], activeThreadId, messages = [], onSwitch, onRename, onPin, onDeleteRequest }: SidebarProps) {
  const [menu, setMenu] = useState<{ threadId: string; anchor: HTMLButtonElement } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const menuThread = menu ? threads.find((thread) => thread.id === menu.threadId) : undefined;
  const toast = useToast();
  const ghosts = useLeavingThreads(threads);
  const groups = useMemo(() => groupSessions(ghosts.length ? [...threads, ...ghosts] : threads), [threads, ghosts]);
  const leavingIds = useMemo(() => new Set(ghosts.map((thread) => thread.id)), [ghosts]);
  // After Enter or Escape in the rename field, focus goes back to the row rather than falling to <body>.
  const restoreFocusTo = useRef<string | null>(null);
  useEffect(() => {
    if (editingId !== null || restoreFocusTo.current === null) return;
    const id = restoreFocusTo.current;
    restoreFocusTo.current = null;
    const row = Array.from(document.querySelectorAll<HTMLElement>(".app-sidebar .session[data-thread-id]")).find((item) => item.dataset.threadId === id);
    row?.querySelector<HTMLElement>(".session-main")?.focus({ preventScroll: true });
  }, [editingId]);

  useEffect(() => { if (menu && !menuThread) setMenu(null); }, [menu, menuThread]);

  const commitRename = (thread: ThreadSummary, raw: string, byKey: boolean) => {
    const next = raw.trim();
    if (byKey) restoreFocusTo.current = thread.id;
    setEditingId(null);
    if (next && next !== thread.title) onRename?.(thread.id, next);
  };
  const copyTranscript = () => { void navigator.clipboard?.writeText(transcriptText(messages)).then(() => toast("Transcript copied")).catch(() => undefined); };

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
          const leaving = leavingIds.has(thread.id);
          return <div className={`session${menu?.threadId === thread.id ? " is-menu" : ""}${leaving ? " is-leaving" : ""}`} data-thread-id={thread.id} aria-current={current ? "page" : undefined} inert={leaving || undefined} key={thread.id}>
            {editing
              ? <div className="session-main"><span className="session-mark" aria-hidden="true" /><RenameField initial={thread.title} label="Rename conversation" onCommit={(title, byKey) => commitRename(thread, title, byKey)} onCancel={(byKey) => { if (byKey) restoreFocusTo.current = thread.id; setEditingId(null); }} /></div>
              : <button type="button" className="session-main" title={thread.title} onClick={() => { onSwitch?.(thread.id); onView("companion"); }}>
                <span className={`session-mark ${status?.dot ?? ""}`.trim()} aria-hidden="true" />
                <span className="session-title">{thread.title}</span>
                <span className="session-meta">
                  {status && <><span className={status.cls || undefined}><span key={status.word}>{status.word}</span></span><span aria-hidden="true">·</span></>}
                  {thread.pinned && <Pin className="i sm" aria-label="Pinned" />}
                  <span>{[thread.workspace.label, relativeTime(thread.updatedAt)].filter(Boolean).join(" · ")}</span>
                </span>
              </button>}
            <button type="button" className="session-more" aria-label={`Actions for ${thread.title}`} title="Conversation actions" aria-haspopup="menu" aria-expanded={menu?.threadId === thread.id} onClick={(event) => { const anchor = event.currentTarget; setMenu((open) => open?.threadId === thread.id ? null : { threadId: thread.id, anchor }); }}><MoreHorizontal className="i" aria-hidden="true" /></button>
          </div>;
        })}
      </div>)}
    </div>
    <div className="sidebar-foot">
      <Destination icon={Folder} label="Projects" current={view === "projects"} onClick={() => onView("projects")} />
      <Destination icon={Brain} label="Memory" current={view === "memory"} onClick={() => (onMemory ?? (() => onView("memory")))()} />
      <Destination icon={Settings2} label="Settings" current={view === "settings"} onClick={() => (onSettings ?? (() => onView("settings")))()} />
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
