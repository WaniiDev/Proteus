import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";

const SHOW_MS = 3400; // "leave on their own after a few seconds" (Notice README)
const EXIT_MS = 160; // dur-exit

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

type ToastMessage = { id: number; title: string; body: string; announce: boolean };
type ToastApi = { show: (title: string, body?: string) => void };

const ToastContext = createContext<ToastApi>({ show: () => undefined });
const AnnouncementContext = createContext("");

/** `const toast = useToast(); toast("Transcript copied")`. Past tense, one at a time: a new toast replaces the one showing. */
export function useToast(): ToastApi["show"] {
  return useContext(ToastContext).show;
}

/**
 * The text of the toast showing now, for a surface that owns a live region to announce (the Island's `announcement`).
 * Empty while no toast shows or when the toast announces itself.
 */
export function useToastAnnouncement(): string {
  return useContext(AnnouncementContext);
}

// A toast is not a second live region. The Island already owns the page's polite region, so while an Island is mounted
// the toast is silent here and its text goes out through useToastAnnouncement(). Where no Island is mounted (Projects,
// Settings) the toast is the only thing that can say it, so it is role="status" itself.
const islandMounted = () => typeof document !== "undefined" && document.querySelector(".island") !== null;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const counter = useRef(0);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    if (reducedMotion()) { setToast(null); setLeaving(false); return; }
    setLeaving(true);
    timer.current = setTimeout(() => { setToast(null); setLeaving(false); }, EXIT_MS);
  }, []);

  const show = useCallback((title: string, body = "") => {
    clearTimeout(timer.current);
    counter.current += 1;
    setLeaving(false);
    setToast({ id: counter.current, title, body, announce: !islandMounted() });
    timer.current = setTimeout(dismiss, SHOW_MS);
  }, [dismiss]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);
  const announcement = toast && !toast.announce ? [toast.title, toast.body].filter(Boolean).join(". ") : "";

  return <ToastContext.Provider value={api}>
    <AnnouncementContext.Provider value={announcement}>
      {children}
      {toast && <div key={toast.id} className={`notice toast${leaving ? " is-leaving" : ""}`} role={toast.announce ? "status" : undefined}>
        <Check className="i" aria-hidden="true" />
        <div className="toast-copy"><strong>{toast.title}</strong>{toast.body && <p>{toast.body}</p>}</div>
        <button type="button" className="icon-btn toast-dismiss" aria-label="Dismiss" title="Dismiss" onClick={dismiss}><X className="i sm" aria-hidden="true" /></button>
      </div>}
    </AnnouncementContext.Provider>
  </ToastContext.Provider>;
}
