import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ThreadSummary } from "../shared/contracts";
import {
  ChevronLeft,
  House,
  MoreHorizontal,
  PanelsTopLeft,
  Pencil,
  SlidersHorizontal,
  SquarePen,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { groupThreads } from "./ui-helpers";

export type View = "companion" | "projects" | "settings";

type SidebarProps = {
  view: View;
  open: boolean;
  disabled: boolean;
  onView: (view: View) => void;
  onToggle: () => void;
  onCreate: () => void;
  threads?: ThreadSummary[];
  activeThreadId?: string | null;
  onSwitch?: (threadId: string) => void;
  onRename?: (threadId: string, title: string) => void;
  onDeleteRequest?: (thread: ThreadSummary) => void;
};

type PrimaryView = Exclude<View, "settings">;

const proteusOrbIconUrl = new URL("./assets/proteus-orb-256.png", import.meta.url).href;
const SESSION_MENU_WIDTH = 126;
const SESSION_MENU_HEIGHT = 78;
const SESSION_MENU_GAP = 4;
const SESSION_MENU_EDGE = 8;

export function sessionMenuPosition(rect: Pick<DOMRect, "top" | "bottom" | "right">, viewportWidth: number, viewportHeight: number) {
  const left = Math.min(Math.max(SESSION_MENU_EDGE, rect.right - SESSION_MENU_WIDTH), Math.max(SESSION_MENU_EDGE, viewportWidth - SESSION_MENU_WIDTH - SESSION_MENU_EDGE));
  const below = rect.bottom + SESSION_MENU_GAP;
  const top = below + SESSION_MENU_HEIGHT <= viewportHeight - SESSION_MENU_EDGE
    ? below
    : Math.max(SESSION_MENU_EDGE, rect.top - SESSION_MENU_HEIGHT - SESSION_MENU_GAP);
  return { left, top };
}

const PRIMARY_LINKS: ReadonlyArray<{ view: PrimaryView; label: string; icon: LucideIcon }> = [
  { view: "companion", label: "Home", icon: House },
  { view: "projects", label: "Projects", icon: PanelsTopLeft },
];

function NavIcon({ icon: Glyph }: { icon: LucideIcon }) {
  return <Glyph className="app-nav__glyph" size={18} strokeWidth={1.65} aria-hidden="true" />;
}

function BrandMark() {
  return <span className="app-nav__orb-mark" aria-hidden="true">
    <img className="app-nav__orb-image" src={proteusOrbIconUrl} alt="" />
  </span>;
}

export function Sidebar({ view, open, disabled, onView, onToggle, onCreate, threads = [], activeThreadId, onSwitch, onRename, onDeleteRequest }: SidebarProps) {
  const brandButtonRef = useRef<HTMLButtonElement>(null);
  const sessionMenuRef = useRef<HTMLDivElement>(null);
  const sessionMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(open);
  const [menuThreadId, setMenuThreadId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const groups = useMemo(() => groupThreads(threads), [threads]);

  useEffect(() => {
    if (wasOpenRef.current && !open) window.requestAnimationFrame(() => brandButtonRef.current?.focus());
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) {
      setMenuThreadId(null);
      setEditingThreadId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menuThreadId || editingThreadId) {
        setMenuThreadId(null);
        setEditingThreadId(null);
        return;
      }
      if (window.innerWidth < 1100) {
        event.preventDefault();
        onToggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingThreadId, menuThreadId, onToggle, open]);

  useEffect(() => {
    if (!menuThreadId) return undefined;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (sessionMenuRef.current?.contains(target) || sessionMenuButtonRef.current?.contains(target)) return;
      setMenuThreadId(null);
    };
    const close = () => setMenuThreadId(null);
    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menuThreadId]);

  const beginRename = (thread: ThreadSummary) => {
    setMenuThreadId(null);
    setEditingThreadId(thread.id);
    setEditingTitle(thread.title);
  };
  const submitRename = (threadId: string) => {
    const next = editingTitle.trim();
    if (next) onRename?.(threadId, next);
    setEditingThreadId(null);
  };
  const toggleSessionMenu = (threadId: string, button: HTMLButtonElement) => {
    if (menuThreadId === threadId) {
      setMenuThreadId(null);
      return;
    }
    sessionMenuButtonRef.current = button;
    setMenuPosition(sessionMenuPosition(button.getBoundingClientRect(), window.innerWidth, window.innerHeight));
    setMenuThreadId(threadId);
  };
  const menuThread = menuThreadId ? threads.find((thread) => thread.id === menuThreadId) : undefined;

  return <><aside className={`app-nav${open ? " app-nav--open" : ""}`} aria-label="Main navigation">
    <div className="app-nav__surface">
      <header className="app-nav__header window-drag-region electrobun-webkit-app-region-drag">
        <button
          ref={brandButtonRef}
          className="app-nav__brand electrobun-webkit-app-region-no-drag"
          type="button"
          onClick={onToggle}
          aria-label={open ? "Collapse navigation" : "Open navigation"}
          aria-expanded={open}
          title={open ? "Collapse navigation" : "Open navigation"}
          data-tooltip={open ? "Collapse navigation" : "Open navigation"}
        >
          <BrandMark />
          <span className="app-nav__brand-word">Proteus</span>
          <ChevronLeft className="app-nav__collapse" size={16} strokeWidth={1.7} aria-hidden="true" />
        </button>
      </header>

      <button
        className="app-nav__item app-nav__action electrobun-webkit-app-region-no-drag"
        type="button"
        onClick={onCreate}
        disabled={disabled}
        aria-label={disabled ? "Available when the current response finishes" : "New chat"}
        title={disabled ? "Available when the current response finishes" : "New chat"}
        data-tooltip="New chat"
      >
        <span className="app-nav__icon-track"><NavIcon icon={SquarePen} /></span>
        <span className="app-nav__label">New chat</span>
      </button>

      <nav className="app-nav__menu" aria-label="Primary">
        {PRIMARY_LINKS.map(({ view: linkView, label, icon }) => <button
          className={`app-nav__item app-nav__link${view === linkView ? " app-nav__link--active" : ""}`}
          type="button"
          key={linkView}
          onClick={() => onView(linkView)}
          aria-label={label}
          aria-current={view === linkView ? "page" : undefined}
          title={label}
          data-tooltip={label}
        >
          <span className="app-nav__icon-track"><NavIcon icon={icon} /></span>
          <span className="app-nav__label">{label}</span>
        </button>)}
      </nav>

      <section className="app-nav__sessions" aria-label="Conversations">
        <div className="app-nav__sessions-head"><span>Recent</span><small>{threads.length}</small></div>
        <div className="app-nav__session-list">
          {groups.length === 0 && <p className="app-nav__empty">Your recent conversations will appear here.</p>}
          {groups.map((group) => <div className="app-nav__session-group" key={group.name}>
            <span className="app-nav__section-label">{group.name}</span>
            {group.threads.map((thread) => <div className={`app-nav__session${thread.id === activeThreadId ? " active" : ""}`} key={thread.id}>
              {editingThreadId === thread.id ? <form className="app-nav__rename" onSubmit={(event) => { event.preventDefault(); submitRename(thread.id); }}>
                <input autoFocus value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} maxLength={120} aria-label={`Rename ${thread.title}`} onBlur={() => submitRename(thread.id)} />
              </form> : <button type="button" className="app-nav__session-main" onClick={() => { onSwitch?.(thread.id); onView("companion"); }} aria-current={thread.id === activeThreadId ? "page" : undefined} title={thread.title}>
                <span className={`app-nav__status ${thread.activity}`} aria-label={thread.activity} />
                <span className="app-nav__session-copy"><strong>{thread.title}</strong><small>{thread.workspace.label}</small></span>
                {thread.attention > 0 && <b>{thread.attention}</b>}
              </button>}
              {editingThreadId !== thread.id && <button type="button" className="app-nav__session-more" aria-label={`Actions for ${thread.title}`} aria-expanded={menuThreadId === thread.id} onClick={(event) => toggleSessionMenu(thread.id, event.currentTarget)}><MoreHorizontal size={15} /></button>}
            </div>)}
          </div>)}
        </div>
      </section>

      <footer className="app-nav__footer">
        <button
          className={`app-nav__item app-nav__link${view === "settings" ? " app-nav__link--active" : ""}`}
          type="button"
          onClick={() => onView("settings")}
          aria-label="Settings"
          aria-current={view === "settings" ? "page" : undefined}
          title="Settings"
          data-tooltip="Settings"
        >
          <span className="app-nav__icon-track"><NavIcon icon={SlidersHorizontal} /></span>
          <span className="app-nav__label">Settings</span>
        </button>
      </footer>
    </div>
  </aside>{menuThread && createPortal(<div ref={sessionMenuRef} className="app-nav__session-menu" style={menuPosition} role="menu">
    <button type="button" role="menuitem" onClick={() => beginRename(menuThread)}><Pencil size={13} /> Rename</button>
    <button type="button" role="menuitem" className="danger" onClick={() => { setMenuThreadId(null); onDeleteRequest?.(menuThread); }}><Trash2 size={13} /> Delete</button>
  </div>, document.body)}</>;
}
