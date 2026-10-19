import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { DiagnosticEntry, DiagnosticsSnapshot } from "../../shared/contracts";
import { rpc } from "../lib/bridge";
import { Icon } from "./Icon";

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
  return <section className="card settings-card diagnostics-card">
    <div className="settings-section-head"><div><span className="settings-eyebrow">Developer tools</span><h2 className="title-md">Runtime diagnostics</h2><p className="settings-intro">Captures emitted Mastra lifecycle events, tool inputs and outputs, RPC timing, storage timing, and provider-emitted reasoning. Private chain-of-thought is never exposed.</p></div><label className="diagnostics-toggle"><input type="checkbox" checked={diagnostics?.enabled ?? true} onChange={(event) => rpc.request["diagnostics.set-enabled"]({ enabled: event.target.checked }).then(setDiagnostics)} /><span>Capture</span></label></div>
    <div className="diagnostics-toolbar">
      <div className="model-search diagnostics-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter events, IDs, or payloads" aria-label="Filter diagnostics" /></div>
      <select value={source} onChange={(event) => setSource(event.target.value as typeof source)} aria-label="Diagnostic source"><option value="all">All sources</option><option value="mastra">Mastra</option><option value="runtime">Runtime</option><option value="rpc">RPC</option><option value="storage">Storage</option></select>
      <button className="btn-outline sm" type="button" onClick={refresh}><Icon name="refresh" size={15} /> Refresh</button>
      <button className="btn-outline sm" type="button" onClick={copyReport}><Icon name="copy" size={15} /> Copy report</button>
      <button className="btn-outline sm" type="button" onClick={() => rpc.request["diagnostics.export"]().then((result) => setExportPath(result.path))}>Export</button>
      <button className="btn-danger-ghost" type="button" onClick={() => rpc.request["diagnostics.clear"]().then(setDiagnostics)}>Clear</button>
    </div>
    <div className="diagnostics-meta"><span>{entries.length.toLocaleString()} visible events</span>{diagnostics?.filePath && <code>{diagnostics.filePath}</code>}{exportPath && <span>Exported to <code>{exportPath}</code></span>}</div>
    {error && <p className="settings-note error">{error}</p>}
    <div className="diagnostics-list" aria-live="polite">
      {entries.map((entry) => <details className={`diagnostic-entry source-${entry.source}`} key={entry.sequence}>
        <summary><span className="diagnostic-sequence">#{entry.sequence}</span><span className="diagnostic-source">{entry.source}</span><strong>{entry.type}</strong>{entry.phase && <span>{entry.phase}</span>}{entry.durationMs !== undefined && <time>{entry.durationMs.toFixed(1)} ms</time>}<time>{new Date(entry.timestamp).toLocaleTimeString()}</time></summary>
        <div className="diagnostic-identifiers">{entry.threadId && <code>thread {entry.threadId}</code>}{entry.runId && <code>run {entry.runId}</code>}{entry.toolCallId && <code>tool {entry.toolCallId}</code>}</div>
        {entry.payload !== undefined && <pre>{JSON.stringify(entry.payload, null, 2)}</pre>}
      </details>)}
      {entries.length === 0 && <p className="diagnostics-empty">No matching events yet. Reproduce the plan approval bug, then inspect the latest events here.</p>}
    </div>
  </section>;
}
