import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

const EXIT_MS = 160; // dur-exit (ADR 0002: every overlay has an exit)
const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

type ModalProps = {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

// Confirms something destructive or irreversible. Cancel is focused on open, Tab is trapped,
// Escape cancels, the scrim and dialog leave over dur-exit, and focus returns to the trigger.
export function Modal({ title, children, confirmLabel, cancelLabel = "Cancel", busy = false, onCancel, onConfirm }: ModalProps) {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => {
      clearTimeout(timer.current);
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  const left = useRef(false);
  const leave = useCallback((then: () => void) => {
    if (left.current) return;
    left.current = true;
    setLeaving(true);
    const ms = reducedMotion() ? 0 : EXIT_MS;
    if (ms === 0) then();
    else timer.current = setTimeout(then, ms);
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!busy) leave(onCancel);
      return;
    }
    if (event.key !== "Tab") return;
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) { event.preventDefault(); return; }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) { event.preventDefault(); first.focus(); }
  };

  return (
    <div className={`scrim${leaving ? " is-leaving" : ""}`} tabIndex={-1} onKeyDown={onKeyDown}>
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
        <h2 id={titleId}>{title}</h2>
        <p id={bodyId}>{children}</p>
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="btn btn-secondary sm" disabled={busy || leaving} onClick={() => leave(onCancel)}>{cancelLabel}</button>
          <button type="button" className="btn btn-danger sm" disabled={busy || leaving} onClick={() => leave(onConfirm)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
