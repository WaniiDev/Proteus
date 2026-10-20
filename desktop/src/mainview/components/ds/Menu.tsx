import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

const EXIT_MS = 160; // dur-exit (ADR 0002: menus are absorbed back into their trigger)
const EDGE = 12;
const GAP = 8;

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

type MenuContextValue = { choose: (action: () => void) => void };
const MenuContext = createContext<MenuContextValue | null>(null);

export type MenuProps = {
  /** Accessible name, e.g. "Actions for Q3 planning". */
  label: string;
  /** The button that opened the menu. Focus returns to it, and a press on it is not an outside click. */
  anchor: HTMLElement | null;
  /** "beside" opens to the right of the anchor (the sidebar), "below" under it, right-aligned (a header). */
  placement?: "beside" | "below";
  className?: string;
  /** Called after the exit transition. */
  onClose: () => void;
  children: ReactNode;
};

// A Tide droplet: it buds out of its trigger and is absorbed back into it. Opens with focus on its first item
// (once per opening); Up, Down, Home and End move; Escape and an outside press close it.
export function Menu({ label, anchor, placement = "beside", className = "", onClose, children }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const left = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const leave = useCallback((restoreFocus: boolean, then?: () => void) => {
    if (left.current) return;
    left.current = true;
    setLeaving(true);
    const finish = () => {
      onCloseRef.current();
      if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
      then?.();
    };
    if (reducedMotion()) finish();
    else timer.current = setTimeout(finish, EXIT_MS);
  }, [anchor]);

  useEffect(() => () => clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu || !anchor) { setStyle({}); return; }
    const rect = anchor.getBoundingClientRect();
    const height = menu.offsetHeight || 200;
    const width = menu.offsetWidth || 212;
    if (placement === "below") {
      const x = Math.max(EDGE, Math.min(rect.right - width, window.innerWidth - width - EDGE));
      setStyle({ left: Math.round(x), top: Math.round(Math.min(rect.bottom + 6, Math.max(EDGE, window.innerHeight - height - EDGE))), transformOrigin: "top right" });
    } else {
      const x = Math.min(rect.right + GAP, Math.max(EDGE, window.innerWidth - width - EDGE));
      const y = Math.max(EDGE, Math.min(rect.top - 6, window.innerHeight - height - EDGE));
      setStyle({ left: Math.round(x), top: Math.round(y), transformOrigin: `0 ${Math.round(Math.max(0, rect.top - y) + rect.height / 2)}px` });
    }
  }, [anchor, placement]);

  // Focus the first item once per opening. The menu stays visibility:hidden until it is positioned, and a hidden element
  // ignores focus(), so this waits for the commit that clears the hidden style.
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || style.visibility === "hidden") return;
    focused.current = true;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [style]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor?.contains(target)) return;
      leave(false);
    };
    const dismiss = () => leave(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
    };
  }, [anchor, leave]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      leave(true);
      return;
    }
    if (event.key === "Tab") {
      // The menu is portalled to the end of <body>: move focus to the anchor now and let the default Tab carry on from there,
      // so focus continues to the anchor's neighbour rather than falling off the end of the page.
      if (anchor?.isConnected) anchor.focus({ preventScroll: true });
      leave(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next]!.focus();
  };

  const context = useMemo<MenuContextValue>(() => ({ choose: (action) => leave(true, action) }), [leave]);

  const menu = <MenuContext.Provider value={context}>
    <div ref={ref} className={`menu ${className}${leaving ? " is-leaving" : ""}`.trim()} role="menu" aria-label={label} style={style} onKeyDown={onKeyDown}>{children}</div>
  </MenuContext.Provider>;
  return typeof document === "undefined" ? menu : createPortal(menu, document.body);
}

type MenuItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "role"> & {
  onSelect: () => void;
  danger?: boolean;
  icon?: ReactNode;
  /** Why the item is unavailable, in words. Shown when `disabled`. */
  reason?: string;
};

// Choosing an item lets the menu leave, returns focus to its trigger, then runs the action.
export function MenuItem({ onSelect, danger = false, icon, reason, disabled, className = "", children, ...rest }: MenuItemProps) {
  const menu = useContext(MenuContext);
  return <button {...rest} type="button" role="menuitem" className={`${danger ? "danger " : ""}${disabled ? "is-disabled " : ""}${className}`.trim() || undefined} disabled={disabled} title={disabled ? reason : rest.title} onClick={() => (menu ? menu.choose(onSelect) : onSelect())}>
    {icon}<span className="menu-label">{children}</span>{disabled && reason && <small className="menu-reason">{reason}</small>}
  </button>;
}

export function MenuRule() {
  return <hr />;
}
