import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

const EXIT_MS = 160; // dur-exit (ADR 0002: every overlay has an exit)
const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// The system Modal's scrim and dialog, for a conversation's lists (files, search, details). It informs rather than
// confirms, so it has one Close button. Close is focused on open, Tab is trapped, Escape closes, the dialog leaves
// over dur-exit and focus returns to the menu's trigger.
export function ConversationDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [leaving, setLeaving] = useState(false);
  const left = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      clearTimeout(timer.current);
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  const leave = useCallback(() => {
    if (left.current) return;
    left.current = true;
    setLeaving(true);
    if (reducedMotion()) onClose();
    else timer.current = setTimeout(onClose, EXIT_MS);
  }, [onClose]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); leave(); return; }
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
      <div ref={dialogRef} className="modal conversation-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        <div className="conversation-dialog-body">{children}</div>
        <div className="modal-actions">
          <button ref={closeRef} type="button" className="btn btn-secondary sm" disabled={leaving} onClick={leave}>Close</button>
        </div>
      </div>
    </div>
  );
}
