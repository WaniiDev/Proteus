import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, File, Files, Folder, FolderOpen, Gauge, ListChecks, LoaderCircle, RefreshCw, Search, Sparkles, X } from "lucide-react";
import type { RuntimeSnapshot, WorkbenchTask, WorkspaceFile, WorkspaceTreeEntry } from "../shared/contracts";
import { goalFromMessages } from "./ui-helpers";

export type ContextPaneTab = "activity" | "files" | "search" | "skills" | "details";

type Props = {
  snapshot: RuntimeSnapshot;
  tab: ContextPaneTab;
  onTabChange: (tab: ContextPaneTab) => void;
  onClose: () => void;
  onJump: (id: string) => void;
};

const TABS: ReadonlyArray<{ id: ContextPaneTab; label: string; icon: typeof Files }> = [
  { id: "activity", label: "Activity", icon: ListChecks },
  { id: "files", label: "Files", icon: Files },
  { id: "search", label: "Search", icon: Search },
  { id: "skills", label: "Skills", icon: Sparkles },
  { id: "details", label: "Details", icon: Gauge },
];

function flatten(entries: WorkspaceTreeEntry[]): WorkspaceTreeEntry[] {
  return entries.flatMap((entry) => [entry, ...(entry.children ? flatten(entry.children) : [])]);
}

function formatBytes(size?: number): string {
  if (size === undefined) return "";
  if (size < 1_000) return `${size} B`;
  if (size < 1_000_000) return `${(size / 1_000).toFixed(1)} KB`;
  return `${(size / 1_000_000).toFixed(1)} MB`;
}

export function ContextPane({ snapshot, tab, onTabChange, onClose, onJump }: Props) {
  const [tree, setTree] = useState<WorkspaceTreeEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [file, setFile] = useState<WorkspaceFile | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"bm25" | "vector" | "hybrid">("bm25");
  const [results, setResults] = useState<Array<{ id: string; content: string; score: number }>>([]);
  const [skills, setSkills] = useState<Array<{ name: string; description: string; path: string; source: string; conflict: boolean; content?: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const scopeKey = `${snapshot.activeThreadId}:${snapshot.activeWorkspace.label}`;
  const workspaceReady = snapshot.activeWorkspace.availability === "ready";

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { rpc } = await import("./bridge");
      setTree(await rpc.request["workspace.tree"]({ path: "", depth: 4 }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Workspace is unavailable");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    setTree([]);
    setSelectedPath(null);
    setFile(null);
    setResults([]);
    setError(null);
    if (workspaceReady) void refresh();
  }, [refresh, scopeKey, workspaceReady]);

  const openFile = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      const { rpc } = await import("./bridge");
      const next = await rpc.request["workspace.read"]({ path });
      setSelectedPath(path);
      setFile(next);
      setDraft(next.content ?? "");
      setDirty(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "File could not be opened");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!file || file.kind !== "text") return;
    setBusy(true);
    setError(null);
    try {
      const { rpc } = await import("./bridge");
      const next = await rpc.request["workspace.write"]({ path: file.path, content: draft, expectedVersion: file.version });
      setFile(next);
      setDirty(false);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "File could not be saved");
    } finally {
      setBusy(false);
    }
  };

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { rpc } = await import("./bridge");
      setResults(await rpc.request["workspace.search"]({ query: query.trim(), mode: searchMode, topK: 20 }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Search failed");
    } finally {
      setBusy(false);
    }
  };

  const loadSkills = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { rpc } = await import("./bridge");
      setSkills(await rpc.request["workspace.skills"]({ load: true }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Skills could not be loaded");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "skills" && skills.length === 0) void loadSkills();
  }, [loadSkills, skills.length, tab]);

  const files = useMemo(() => flatten(tree).filter((item) => item.kind === "file"), [tree]);
  const attentionItems = snapshot.workbench.pendingInteractions.filter((item) => item.status === "pending" || item.status === "resolving");
  const completedTasks = snapshot.workbench.tasks.filter((task) => task.status === "completed").length;
  const selectedModel = snapshot.models.find((model) => model.id === snapshot.selectedModelId);
  const selectedProvider = snapshot.providers.find((provider) => provider.id === (selectedModel?.providerId ?? snapshot.selectedProviderId));

  return <aside className="context-pane" id="conversation-context" aria-label="Conversation context">
    <header className="context-pane__head">
      <div><span className="caption-uppercase">Current work</span><strong>{snapshot.workbench.goal || goalFromMessages(snapshot.messages, "Conversation context")}</strong></div>
      <button type="button" className="context-pane__close" onClick={onClose} aria-label="Close context pane"><X size={17} /></button>
    </header>
    <nav className="context-pane__tabs" aria-label="Context views">
      {TABS.map(({ id, label, icon: Glyph }) => <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => onTabChange(id)} aria-current={tab === id ? "page" : undefined} title={label}><Glyph size={15} /><span>{label}</span>{id === "activity" && attentionItems.length > 0 && <b>{attentionItems.length}</b>}</button>)}
    </nav>
    {busy && <div className="context-pane__loading"><LoaderCircle size={14} className="spin" /> Working...</div>}
    {error && <p className="context-pane__error" role="alert">{error}</p>}
    <div className="context-pane__body">
      {tab === "activity" && <section className="context-activity">
        {attentionItems.length > 0 && <div className="context-section context-attention"><div className="context-section__title"><span>Needs your input</span><b>{attentionItems.length}</b></div>{attentionItems.map((item) => <button type="button" className="context-jump" key={item.id} onClick={() => onJump(item.id)}><span>{item.kind === "submit_plan" ? "Review plan" : item.title}</span><ArrowRight size={14} /></button>)}</div>}
        {snapshot.workbench.tasks.length > 0 ? <div className="context-section"><div className="context-section__title"><span>Plan and tasks</span><small>{completedTasks}/{snapshot.workbench.tasks.length}</small></div><ul className="context-task-list">{snapshot.workbench.tasks.map((task: WorkbenchTask) => <li className={task.status} key={task.id}><span className="context-task-check">{task.status === "completed" ? <Check size={11} /> : task.status === "in_progress" ? <span /> : null}</span><span>{task.status === "in_progress" ? task.activeForm : task.content}</span></li>)}</ul></div> : <div className="context-empty"><ListChecks size={24} /><strong>No structured work yet</strong><p>Plans, tasks, and requests for your input will appear here as Proteus works.</p></div>}
        {snapshot.workbench.queuedFollowUpCount > 0 && <div className="context-section"><div className="context-section__title"><span>Queued follow-ups</span><b>{snapshot.workbench.queuedFollowUpCount}</b></div><p>{snapshot.workbench.queuedFollowUpCount === 1 ? "One message will be sent" : `${snapshot.workbench.queuedFollowUpCount} messages will be sent`} after the current response.</p></div>}
      </section>}

      {tab === "files" && <>{file ? <section className="file-preview"><div className="file-preview__bar"><button type="button" onClick={() => { setFile(null); setSelectedPath(null); }}>Back to files</button><span title={file.path}>{file.path}</span>{file.kind === "text" && <button type="button" disabled={!dirty || busy} onClick={() => void save()}>Save</button>}</div>{file.kind === "text" ? <textarea aria-label={`Edit ${file.path}`} value={draft} onChange={(event) => { setDraft(event.target.value); setDirty(event.target.value !== file.content); }} spellCheck={false} /> : file.kind === "image" ? <img src={file.dataUrl} alt={file.path} /> : file.kind === "pdf" ? <iframe src={file.dataUrl} title={file.path} /> : <div className="context-empty">Binary preview is unavailable.</div>}<footer>{formatBytes(file.size)} · {new Date(file.modifiedAt).toLocaleString()}{file.truncated ? " · Preview truncated" : ""}</footer></section> : <section className="file-browser"><div className="workspace-toolbar"><span>{files.length} files</span><button type="button" onClick={() => void refresh()}><RefreshCw size={14} /> Refresh</button></div>{!workspaceReady ? <div className="context-empty"><FolderOpen size={26} /><p>Reconnect this project folder before browsing files.</p></div> : tree.length === 0 && !busy ? <div className="context-empty"><FolderOpen size={26} /><p>This workspace has no visible files.</p></div> : <Tree entries={tree} selected={selectedPath} onOpen={(path) => void openFile(path)} />}</section>}</>}

      {tab === "search" && <section className="workspace-search"><form onSubmit={(event) => { event.preventDefault(); void search(); }}><div className="workspace-search__input"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this workspace" aria-label="Search workspace" /><button type="submit">Search</button></div><div className="workspace-search__modes">{(["bm25", "vector", "hybrid"] as const).map((item) => <button type="button" className={searchMode === item ? "active" : ""} onClick={() => setSearchMode(item)} key={item}>{item === "bm25" ? "Keyword" : item === "vector" ? "Semantic" : "Hybrid"}</button>)}</div></form>{results.length === 0 ? <div className="context-empty"><Search size={26} /><p>Index workspace files, then search by keyword or meaning.</p><button type="button" disabled={!files.length} onClick={() => void import("./bridge").then(({ rpc }) => rpc.request["workspace.index"]({ paths: files.map((item) => item.path) }))}>Index {files.length} files</button></div> : <ul className="search-results">{results.map((result) => <li key={result.id}><button type="button" onClick={() => { onTabChange("files"); void openFile(result.id); }}><strong>{result.id}</strong><span>{Math.round(result.score * 100)}%</span><p>{result.content.slice(0, 240)}</p></button></li>)}</ul>}</section>}

      {tab === "skills" && <section>{skills.length === 0 && !busy ? <div className="context-empty"><Sparkles size={26} /><strong>No project skills found</strong><p>Skills discovered in this workspace will appear here.</p></div> : <ul className="skill-list">{skills.map((skill) => <li key={`${skill.source}:${skill.name}`}><details><summary><span><strong>{skill.name}</strong><small>{skill.description}</small></span>{skill.conflict && <b>Conflict</b>}</summary><code>{skill.path}</code><pre>{skill.content}</pre></details></li>)}</ul>}</section>}

      {tab === "details" && <section className="context-details"><div className="context-section"><div className="context-section__title"><span>Session</span></div><dl><div><dt>Status</dt><dd>{snapshot.workbench.status}</dd></div><div><dt>Workspace</dt><dd>{snapshot.activeWorkspace.label}</dd></div><div><dt>Availability</dt><dd>{snapshot.activeWorkspace.availability}</dd></div><div><dt>Provider</dt><dd>{selectedProvider?.name ?? snapshot.selectedProviderId}</dd></div><div><dt>Model</dt><dd>{selectedModel?.name ?? snapshot.selectedModelId}</dd></div></dl></div><div className="context-section"><div className="context-section__title"><span>Token usage</span></div><dl><div><dt>Prompt</dt><dd>{snapshot.workbench.tokenUsage.promptTokens.toLocaleString()}</dd></div><div><dt>Completion</dt><dd>{snapshot.workbench.tokenUsage.completionTokens.toLocaleString()}</dd></div><div><dt>Total</dt><dd>{snapshot.workbench.tokenUsage.totalTokens.toLocaleString()}</dd></div></dl></div></section>}
    </div>
  </aside>;
}

function Tree({ entries, selected, onOpen }: { entries: WorkspaceTreeEntry[]; selected: string | null; onOpen: (path: string) => void }) {
  return <ul className="workspace-tree">{entries.map((entry) => <li key={entry.path}>{entry.kind === "directory" ? <details open><summary><Folder size={14} />{entry.name}</summary>{entry.children && <Tree entries={entry.children} selected={selected} onOpen={onOpen} />}</details> : <button type="button" className={selected === entry.path ? "selected" : ""} onClick={() => onOpen(entry.path)}><File size={14} /><span>{entry.name}</span><small>{formatBytes(entry.size)}</small></button>}</li>)}</ul>;
}
