import { useMemo, useState, type FormEvent } from "react";
import type { RuntimeSnapshot, WorkspaceTreeEntry } from "../../../shared/contracts";
import { rpc } from "../../lib/bridge";
import { ConversationDialog } from "./ConversationDialog";
import { flattenFiles } from "./FilesDialog";

type Mode = "bm25" | "vector" | "hybrid";
const MODES: ReadonlyArray<{ id: Mode; label: string }> = [{ id: "bm25", label: "Keyword" }, { id: "vector", label: "Semantic" }, { id: "hybrid", label: "Hybrid" }];

// Search this conversation's workspace by keyword or meaning. A result opens in the Files dialog.
export function SearchDialog({ snapshot, onOpenFile, onClose }: { snapshot: RuntimeSnapshot; onOpenFile: (path: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("bm25");
  const [results, setResults] = useState<Array<{ id: string; content: string; score: number }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ready = snapshot.activeWorkspace.availability === "ready";

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim() || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try { setResults(await rpc.request["workspace.search"]({ query: query.trim(), mode, topK: 20 })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Search failed"); }
    finally { setBusy(false); }
  };

  const index = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const tree: WorkspaceTreeEntry[] = await rpc.request["workspace.tree"]({ path: "", depth: 4 });
      const paths = flattenFiles(tree).map((entry) => entry.path);
      const { indexed } = await rpc.request["workspace.index"]({ paths });
      setNotice(`Indexed ${indexed} ${indexed === 1 ? "file" : "files"}. Search again.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Indexing failed"); }
    finally { setBusy(false); }
  };

  const modeIndex = useMemo(() => MODES.findIndex((item) => item.id === mode), [mode]);
  return <ConversationDialog title="Search this conversation" onClose={onClose}>
    <form className="workspace-search-form" onSubmit={(event) => void search(event)}>
      <div className="field">
        <label htmlFor="conversation-search-query">Search this workspace</label>
        <input id="conversation-search-query" className="input" value={query} disabled={!ready} placeholder="A word, or what you mean" onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="workspace-search-row">
        <div className={`segmented slide seg-n-3 seg-at-${modeIndex}`} role="tablist" aria-label="Search mode">
          {MODES.map((item) => <button type="button" role="tab" key={item.id} aria-selected={mode === item.id} onClick={() => setMode(item.id)}>{item.label}</button>)}
        </div>
        <button type="submit" className="btn btn-primary sm" disabled={!ready || busy || !query.trim()}>Search</button>
      </div>
    </form>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="list">
      {!ready ? <div className="list-row quiet">Reconnect this project folder before searching.</div>
        : results === null ? <div className="list-row quiet">{busy ? "Searching…" : "Index workspace files, then search by keyword or meaning."}</div>
        : results.length === 0 ? <div className="list-row quiet">Nothing matched. Index the workspace files if you have not yet.</div>
        : results.map((result) => <button type="button" className="list-row" key={result.id} onClick={() => onOpenFile(result.id)}>
          <span className="row-copy"><span className="row-title" title={result.id}>{result.id}</span><span className="row-sub">{result.content.slice(0, 160)}</span></span>
          <span className="row-end">{Math.round(result.score * 100)}%</span>
        </button>)}
    </div>
    {ready && <p className="list-note">{notice ?? "Search needs the files indexed once."} <button type="button" className="btn btn-ghost sm" disabled={busy} onClick={() => void index()}>Index files</button></p>}
  </ConversationDialog>;
}
