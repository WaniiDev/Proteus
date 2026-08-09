import { useEffect, useRef } from "react";
import {
  BookOpenText,
  ChevronLeft,
  MessagesSquare,
  PanelsTopLeft,
  SlidersHorizontal,
  SquarePen,
  type LucideIcon,
} from "lucide-react";
import type { ThreadSummary } from "../shared/contracts";
import { relativeTime } from "./ui-helpers";

export type View = "companion" | "projects" | "memory" | "settings";

type SidebarProps = {
  view: View;
  open: boolean;
  disabled: boolean;
  onView: (view: View) => void;
  onToggle: () => void;
  onCreate: () => void;
  threads: ThreadSummary[];
  activeThreadId: string | null;
  onSwitch: (threadId: string) => void;
};

type PrimaryView = Exclude<View, "settings">;

const proteusOrbIconUrl = new URL("./assets/proteus-orb-256.png", import.meta.url).href;

const PRIMARY_LINKS: ReadonlyArray<{ view: PrimaryView; label: string; icon: LucideIcon }> = [
  { view: "companion", label: "Companion", icon: MessagesSquare },
  { view: "projects", label: "Projects", icon: PanelsTopLeft },
  { view: "memory", label: "Memory", icon: BookOpenText },
];

function NavIcon({ icon: Glyph }: { icon: LucideIcon }) {
  return <Glyph className="app-nav__glyph" size={19} strokeWidth={1.6} aria-hidden="true" />;
}

function BrandMark() {
  return <span className="app-nav__orb-mark" aria-hidden="true">
    <img className="app-nav__orb-image" src={proteusOrbIconUrl} alt="" />
  </span>;
}

export function Sidebar({ view, open, disabled, onView, onToggle, onCreate, threads, activeThreadId, onSwitch }: SidebarProps) {
  const orbButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(open);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      window.requestAnimationFrame(() => orbButtonRef.current?.focus());
    }
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onToggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onToggle, open]);

  const navigate = (next: View) => onView(next);
  const newChatLabel = disabled ? "Available when the current response finishes" : "New chat";
  const orbLabel = open ? "Close navigation" : "Open navigation";

  return <aside className={`app-nav${open ? " app-nav--open" : ""}`} aria-label="Main navigation">
    <div className="app-nav__surface">
      <div className="app-nav__header window-drag-region electrobun-webkit-app-region-drag">
        <button
          ref={orbButtonRef}
          className="app-nav__orb electrobun-webkit-app-region-no-drag"
          type="button"
          onClick={onToggle}
          aria-label={orbLabel}
          aria-expanded={open}
          title={orbLabel}
          data-tooltip={orbLabel}
        >
          <BrandMark />
        </button>
      </div>

      <button
        className="app-nav__item app-nav__action electrobun-webkit-app-region-no-drag"
        type="button"
        onClick={onCreate}
        disabled={disabled}
        aria-label={newChatLabel}
        title={newChatLabel}
        data-tooltip={newChatLabel}
      >
        <span className="app-nav__icon-track"><NavIcon icon={SquarePen} /></span>
        <span className="app-nav__label">New chat</span>
      </button>

      <nav className="app-nav__menu" aria-label="Primary">
        {PRIMARY_LINKS.map(({ view: linkView, label, icon }) => <button
          className={`app-nav__item app-nav__link${view === linkView ? " app-nav__link--active" : ""}`}
          type="button"
          key={linkView}
          onClick={() => navigate(linkView)}
          aria-label={label}
          aria-current={view === linkView ? "page" : undefined}
          title={label}
          data-tooltip={label}
        >
          <span className="app-nav__icon-track"><NavIcon icon={icon} /></span>
          <span className="app-nav__label">{label}</span>
        </button>)}
      </nav>

      <section className="app-nav__recents" aria-label="Recent chats">
        <span className="app-nav__section-title">Recents</span>
        <div className="app-nav__recent-list">
          {threads.slice(0, 12).map((thread) => <button
            type="button"
            className={`app-nav__recent${thread.id === activeThreadId && view === "companion" ? " app-nav__recent--active" : ""}`}
            key={thread.id}
            title={thread.title}
            onClick={() => {
              onSwitch(thread.id);
              onView("companion");
            }}
          >
            <span>{thread.title}</span>
            <small>{thread.attention > 0 ? `${thread.attention} waiting` : relativeTime(thread.updatedAt)}</small>
          </button>)}
          {threads.length === 0 && <p className="app-nav__recent-empty">Your conversations will appear here.</p>}
        </div>
      </section>

      <div className="app-nav__footer">
        <button
          className={`app-nav__item app-nav__link${view === "settings" ? " app-nav__link--active" : ""}`}
          type="button"
          onClick={() => navigate("settings")}
          aria-label="Settings"
          aria-current={view === "settings" ? "page" : undefined}
          title="Settings"
          data-tooltip="Settings"
        >
          <span className="app-nav__icon-track"><NavIcon icon={SlidersHorizontal} /></span>
          <span className="app-nav__label">Settings</span>
        </button>
        <button className="app-nav__collapse" type="button" onClick={onToggle} aria-label="Collapse sidebar">
          <ChevronLeft size={16} strokeWidth={1.7} />
          <span>Collapse</span>
        </button>
      </div>
    </div>
  </aside>;
}
