import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, File } from "lucide-react";
import type { RuntimeSnapshot, WorkspaceFile, WorkspaceTreeEntry } from "../../../shared/contracts";
import { rpc } from "../../lib/bridge";
import { ConversationDialog } from "./ConversationDialog";

export function flattenFiles(entries: WorkspaceTreeEntry[]): WorkspaceTreeEntry[] {
  return entries.flatMap((entry) => entry.kind === "file" ? [entry] : entry.children ? flattenFiles(entry.children) : []);
}

export function formatBytes(size?: number): string {
  if (size === undefined) return "";
  if (size < 1_000) return `${size} B`;
  if (size < 1_000_000) return `${(size / 1_000).toFixed(1)} KB`;
  return `${(size / 1_000_000).toFixed(1)} MB`;
}

// Files in this conversation's workspace: a List of files, then one file to read (and, for text, edit and save).
export function FilesDialog({ snapshot, initialPath, onClose }: { snapshot: RuntimeSnapshot; initialPath?: string; onClose: () => void }) {
  const [tree, setTree] = useState<WorkspaceTreeEntry[] | null>(null);
  const [file, setFile] = useState<WorkspaceFile | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = snapshot.activeWorkspace.availability === "ready";
  const dirty = file?.kind === "text" && draft !== (file.content ?? "");

  const open = useCallback(async (path: string) => {
    setBusy(true); setError(null);
    try {
      const next = await rpc.request["workspace.read"]({ path });
      setFile(next); setDraft(next.content ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "File could not be opened"); }
    finally { setBusy(false); }
  }, []);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setTree(await rpc.request["workspace.tree"]({ path: "", depth: 4 })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Workspace is unavailable"); setTree([]); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void load();
    if (initialPath) void open(initialPath);
  }, [initialPath, load, open, ready]);

  const save = async () => {
    if (!file || file.kind !== "text") return;
    setBusy(true); setError(null);
    try {
      const next = await rpc.request["workspace.write"]({ path: file.path, content: draft, expectedVersion: file.version });
      setFile(next); setDraft(next.content ?? draft);
      void load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "File could not be saved"); }
    finally { setBusy(false); }
  };

  const files = useMemo(() => flattenFiles(tree ?? []), [tree]);

  return <ConversationDialog title="Files in this conversation" onClose={onClose}>
    {error && <p className="field-error" role="alert">{error}</p>}
    {file ? <>
      <button type="button" className="btn btn-ghost sm" onClick={() => setFile(null)}><ArrowLeft className="i sm" aria-hidden="true" />Files</button>
      <div className="list">
        <div className="list-row"><span className="row-copy"><span className="row-title" title={file.path}>{file.path}</span><span className="row-sub">{[formatBytes(file.size), new Date(file.modifiedAt).toLocaleString(), file.truncated ? "Preview truncated" : ""].filter(Boolean).join(" · ")}</span></span>
          {file.kind === "text" && <span className="row-end"><button type="button" className="btn btn-primary sm" disabled={!dirty || busy} onClick={() => void save()}>Save</button></span>}
        </div>
      </div>
      {file.kind === "text" ? <textarea className="input conversation-file-text mono" aria-label={`Edit ${file.path}`} value={draft} spellCheck={false} onChange={(event) => setDraft(event.target.value)} />
        : file.kind === "image" ? <img className="conversation-file-media" src={file.dataUrl} alt={file.path} />
        : file.kind === "pdf" ? <iframe className="conversation-file-media" src={file.dataUrl} title={file.path} />
        : <div className="list"><div className="list-row quiet">Binary preview is unavailable.</div></div>}
    </> : <div className="list">
      {!ready ? <div className="list-row quiet">Reconnect this project folder before browsing files.</div>
        : tree === null ? <div className="list-row quiet" role="status">Loading files…</div>
        : files.length === 0 ? <div className="list-row quiet">This workspace has no visible files.</div>
        : files.map((entry) => <button type="button" className="list-row" key={entry.path} onClick={() => void open(entry.path)}>
          <File className="i" aria-hidden="true" />
          <span className="row-copy"><span className="row-title" title={entry.path}>{entry.path}</span></span>
          <span className="row-end">{formatBytes(entry.size)}</span>
        </button>)}
    </div>}
  </ConversationDialog>;
}
