import { useId, useRef, type KeyboardEvent, type ReactElement } from "react";

export type SegmentedOption<T extends string> = { value: T; label: string; disabled?: boolean };

export type SegmentedProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the tablist. */
  label: string;
  /** Prefix for tab ids (`${id}-${value}`) so a tabpanel can point back with aria-labelledby. */
  id?: string;
  className?: string;
};

/** The id `Segmented` gives the tab for `value`, for a tabpanel's aria-labelledby. */
export function segmentedTabId(id: string, value: string): string {
  return `${id}-${value}`;
}

/**
 * Two to five peer options on a sunk track with a sliding thumb (DS Segmented, `.slide`).
 * `role="tablist"`/`tab`, a roving tab stop, and arrow, Home and End keys that move and select.
 */
export function Segmented<T extends string>({ options, value, onChange, label, id, className }: SegmentedProps<T>): ReactElement {
  const generated = useId();
  const base = id ?? generated;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const found = options.findIndex((option) => option.value === value);
  const index = found < 0 ? 0 : found;
  const last = useRef({ index, direction: "" });
  if (last.current.index !== index) last.current = { index, direction: index > last.current.index ? "seg-forward" : "seg-back" };

  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const count = options.length;
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % count;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else return;
    event.preventDefault();
    // Skip disabled options in the direction of travel.
    for (let step = 0; step < count && options[next]?.disabled; step += 1) {
      next = event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "End" ? (next - 1 + count) % count : (next + 1) % count;
    }
    const target = options[next];
    if (!target || target.disabled) return;
    refs.current[next]?.focus();
    if (target.value !== value) onChange(target.value);
  };

  const classes = ["segmented", "slide", `seg-n-${Math.min(5, Math.max(2, options.length))}`, `seg-at-${index}`, last.current.direction, className].filter(Boolean).join(" ");
  return (
    <div className={classes} role="tablist" aria-label={label}>
      {options.map((option, i) => (
        <button
          key={option.value}
          ref={(node) => { refs.current[i] = node; }}
          type="button"
          role="tab"
          id={segmentedTabId(base, option.value)}
          aria-selected={i === index}
          tabIndex={i === index ? 0 : -1}
          disabled={option.disabled}
          onClick={() => { if (option.value !== value) onChange(option.value); }}
          onKeyDown={move}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
