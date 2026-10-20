/** A resolved ask or a finished action in the thread: dot + "Label · title — note". */
export function ResolvedLine({ label, title, note, tone = "ok" }: { label: string; title: string; note?: string; tone?: "ok" | "muted" }) {
  return (
    <p className="resolved">
      <span className={tone === "ok" ? "dot ok" : "dot"} aria-hidden="true" />
      <span className="resolved-text">{label} · <span className="resolved-title">{title}</span>{note ? ` — ${note}` : ""}</span>
    </p>
  );
}

export const STOPPED_COPY = "Stopped. Nothing was sent or saved.";

export function StoppedNote() {
  return <p className="stopped">{STOPPED_COPY}</p>;
}
