import { useEffect, useMemo, useState } from "react";
import type { DiagnosticEntry, DiagnosticsSnapshot } from "../../shared/contracts";
import { rpc } from "../lib/bridge";

function diagnosticText(entry: DiagnosticEntry): string {
  return [entry.type, entry.phase, entry.threadId, entry.runId, entry.toolCallId, entry.payload === undefined ? "" : JSON.stringify(entry.payload)].filter(Boolean).join(" ").toLowerCase();
}

export function DiagnosticsPanel() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"all" | DiagnosticEntry["source"]>("all");
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => rpc.request["diagnostics.get"]({ limit: 1_000 }).then((value) => { setDiagnostics(value); setError(null); }).catch(() => setError("Diagnostics could not be loaded."));
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...(diagnostics?.entries ?? [])].reverse().filter((entry) => (source === "all" || entry.source === source) && (!needle || diagnosticText(entry).includes(needle)));
  }, [diagnostics?.entries, query, source]);
  const copyReport = () => {
    if (!diagnostics) return;
    void navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
  };
  const capturing = diagnostics?.enabled ?? true;
  return <div className="list-stack">
    <div className="list-group">
      <div className="list">
        <label className="list-row switch">
          <span className="switch-copy">
            <strong>{capturing ? "Capturing diagnostics" : "Capture is off"}</strong>
            <small>Events stay on this device. Credentials are never recorded.</small>
          </span>
          <input type="checkbox" checked={capturing} onChange={(event) => rpc.request["diagnostics.set-enabled"]({ enabled: event.target.checked }).then(setDiagnostics)} />
          <span className="switch-track" aria-hidden="true" />
        </label>
      </div>
      <p className="list-note">Captures Mastra lifecycle events, tool inputs and outputs, RPC and storage timing, and reasoning the provider emits. Private chain-of-thought is never exposed.</p>
    </div>

    <div className="list-group">
      <div className="list-label">
        <span className="kicker">Recent events · {entries.length.toLocaleString()}</span>
        <span className="diagnostic-actions">
          <button className="btn btn-ghost sm" type="button" onClick={refresh}>Refresh</button>
          <button className="btn btn-ghost sm" type="button" onClick={copyReport}>Copy report</button>
          <button className="btn btn-ghost sm" type="button" onClick={() => rpc.request["diagnostics.export"]().then((result) => setExportPath(result.path))}>Export</button>
        </span>
      </div>
      <div className="list">
        <div className="list-row row-compose">
          <input className="row-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter events, IDs or payloads" aria-label="Filter diagnostics" />
          <select className="row-select" value={source} onChange={(event) => setSource(event.target.value as typeof source)} aria-label="Diagnostic source">
            <option value="all">All sources</option><option value="mastra">Mastra</option><option value="runtime">Runtime</option><option value="rpc">RPC</option><option value="storage">Storage</option>
          </select>
        </div>
      </div>
      {error && <span className="field-error" role="alert">{error}</span>}
      <div className="list diagnostic-log" aria-live="polite">
        {entries.map((entry) => <details className="diagnostic-entry" key={entry.sequence}>
          <summary className="list-row event">
            <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleTimeString([], { hour12: false })}</time>
            <span>{entry.source}</span>
            <span>{entry.type}{entry.phase ? ` · ${entry.phase}` : ""}{entry.durationMs !== undefined ? ` · ${entry.durationMs.toFixed(1)} ms` : ""}</span>
          </summary>
          <div className="diagnostic-detail">
            {(entry.threadId || entry.runId || entry.toolCallId) && <p>{entry.threadId && <code>thread {entry.threadId}</code>}{entry.runId && <code>run {entry.runId}</code>}{entry.toolCallId && <code>tool {entry.toolCallId}</code>}</p>}
            {entry.payload !== undefined && <pre>{JSON.stringify(entry.payload, null, 2)}</pre>}
          </div>
        </details>)}
        {entries.length === 0 && <div className="list-row quiet">No matching events yet.</div>}
      </div>
      {(diagnostics?.filePath || exportPath) && <p className="list-note">{diagnostics?.filePath && <>Log file <code>{diagnostics.filePath}</code>. </>}{exportPath && <>Exported to <code>{exportPath}</code>.</>}</p>}
    </div>

    <div className="list-group">
      <div className="list"><button className="list-row danger" type="button" onClick={() => rpc.request["diagnostics.clear"]().then(setDiagnostics)}>Clear diagnostics</button></div>
      <p className="list-note">Removes the captured events from this device.</p>
    </div>
  </div>;
}
