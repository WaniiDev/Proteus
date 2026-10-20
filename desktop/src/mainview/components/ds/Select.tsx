import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { exitMs } from "./motion";

export type SelectStatus = { text: string; dot?: "ok" | "run" | "warn" | "err" };

export type SelectOption<T extends string> = {
  value: T;
  name: string;
  /** How the choice connects or what it is, shown under the name and after the status in the list. */
  how?: string;
  /** The choice's mark; `small` is true in the list. */
  mark?: (small: boolean) => ReactNode;
  status?: SelectStatus;
  disabled?: boolean;
};

export type SelectProps<T extends string> = {
  options: readonly SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the listbox, for example "Providers". */
  label: string;
  /** Accessible name of the trigger for the chosen option. */
  triggerLabel?: (option: SelectOption<T>) => string;
  disabled?: boolean;
};

const dotClass = (status: SelectStatus) => (status.dot ? `dot ${status.dot}` : "dot");

/**
 * One-of-many choice that opens a listbox under its trigger (DS Select).
 * Down or Up on the trigger opens with focus on the chosen option; Up, Down, Home and End move;
 * Enter or Space picks and closes; Escape closes; focus returns to the trigger.
 */
export function Select<T extends string>({ options, value, onChange, label, triggerLabel, disabled }: SelectProps<T>): ReactElement | null {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const current = options.find((option) => option.value === value) ?? options[0];
  const expanded = open && !leaving;

  useEffect(() => () => clearTimeout(timer.current), []);

  const optionNodes = (): HTMLElement[] => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)') ?? []);

  // Opening puts focus on the chosen option.
  useEffect(() => {
    if (!expanded) return;
    const nodes = optionNodes();
    (nodes.find((node) => node.getAttribute("aria-selected") === "true") ?? nodes[0])?.focus();
  }, [expanded]);

  // A press outside closes the list without taking focus back.
  useEffect(() => {
    if (!expanded) return;
    const away = (event: Event) => { if (!rootRef.current?.contains(event.target as Node)) close(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("mousedown", away);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("mousedown", away); };
  }, [expanded]);

  const openList = () => {
    if (disabled) return;
    clearTimeout(timer.current);
    setLeaving(false);
    setOpen(true);
  };
  const close = (restoreFocus: boolean) => {
    if (!open || leaving) return;
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
    setLeaving(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setOpen(false); setLeaving(false); }, exitMs());
  };
  const pick = (option: SelectOption<T>) => {
    if (option.disabled) return;
    close(true);
    if (option.value !== value) onChange(option.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!expanded) {
      if (event.target === triggerRef.current && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); openList(); }
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === "Tab") { close(false); return; }
    const nodes = optionNodes();
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Enter" || event.key === " ") {
      const focused = nodes[at];
      if (!focused) return;
      event.preventDefault();
      const option = options.find((candidate) => candidate.value === focused.dataset.value);
      if (option) pick(option);
      return;
    }
    if (!nodes.length) return;
    let next: number;
    if (event.key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % nodes.length;
    else if (event.key === "ArrowUp") next = at < 0 ? nodes.length - 1 : (at - 1 + nodes.length) % nodes.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = nodes.length - 1;
    else return;
    event.preventDefault();
    nodes[next]?.focus();
  };

  if (!current) return null;
  return (
    <div className="select" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={open ? listId : undefined}
        aria-label={triggerLabel?.(current)}
        disabled={disabled}
        onClick={() => (expanded ? close(true) : openList())}
      >
        {current.mark?.(false)}
        <span className="row-copy">
          <span className="row-title">{current.name}</span>
          {current.how && <span className="row-sub">{current.how}</span>}
        </span>
        {current.status && <span className="select-status"><span className={dotClass(current.status)} />{current.status.text}</span>}
        <ChevronDown className="i sm chip-caret" aria-hidden="true" />
      </button>
      {open && (
        <div ref={menuRef} id={listId} className={`menu select-menu${leaving ? " is-leaving" : ""}`} role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              className="picker-option"
              data-value={option.value}
              aria-selected={option.value === current.value}
              tabIndex={-1}
              disabled={option.disabled}
              onClick={() => pick(option)}
            >
              {option.mark?.(true)}
              <span>
                <strong>{option.name}</strong>
                {(option.status || option.how) && (
                  <small>
                    {option.status && <><span className={dotClass(option.status)} />{option.status.text}</>}
                    {option.status && option.how && " · "}
                    {option.how}
                  </small>
                )}
              </span>
              <Check className="i sm row-check" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
