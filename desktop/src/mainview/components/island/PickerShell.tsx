import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { EXIT_MS, exitMs } from "../ds/motion";

export { EXIT_MS };

export type PickerShellProps = {
  open: boolean;
  /** Accessible name of the dialog. */
  label: string;
  /** "from-start" aims the droplet at the project chip, "from-end" at the model chip. */
  from: "from-start" | "from-end";
  compact?: boolean;
  /** The chips row: a press inside it is the chips' own business, not an outside click. */
  chipsRef: RefObject<HTMLElement | null>;
  /** Escape or an outside press. `restoreFocus` is true for Escape. */
  onDismiss: (restoreFocus: boolean) => void;
  children: ReactNode;
};

/** What takes focus when a picker opens: the chosen option, else the first one, else the slider. */
const PICKER_FOCUS_ORDER = ['[role="radio"][aria-checked="true"]:not(:disabled)', '[role="radio"]:not(:disabled)', 'input[type="range"]', ".picker-option:not(:disabled)", "button:not(:disabled)"];

/**
 * A Tide droplet that rises above the Island from its chip (`.menu.picker`). It enters with the droplet, leaves for 160ms, opens
 * with focus on the chosen option once per opening, and closes on Escape or an outside press. Up, Down, Home and End move
 * through its radio group. Always mounted by its owner; renders nothing while closed and finished leaving.
 */
export function PickerShell({ open, label, from, compact = false, chipsRef, onDismiss, children }: PickerShellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(open);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (open) {
      setShown(true);
      return undefined;
    }
    const wait = exitMs();
    if (!wait) {
      setShown(false);
      return undefined;
    }
    const timer = setTimeout(() => setShown(false), wait);
    return () => clearTimeout(timer);
  }, [open]);

  // Focus the chosen option once per opening: the only dependency is `open`, so a re-render while open never moves focus.
  useEffect(() => {
    if (!open) return;
    const picker = ref.current;
    for (const selector of PICKER_FOCUS_ORDER) {
      const target = picker?.querySelector<HTMLElement>(selector);
      if (target) {
        target.focus({ preventScroll: true });
        return;
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || chipsRef.current?.contains(target)) return;
      dismiss.current(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, chipsRef]);

  if (!shown && !open) return null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss.current(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    // The slider and the provider tabs own their arrows.
    const target = event.target as HTMLElement;
    if (target.matches('input[type="range"], [role="tab"]')) return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="radio"]:not(:disabled)') ?? []);
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1) % items.length : (index <= 0 ? items.length - 1 : index - 1);
    items[next]?.focus();
  };

  return (
    <div ref={ref} className={`menu picker${compact ? " compact" : ""} ${from}${open ? "" : " is-leaving"}`} role="dialog" aria-label={label} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
