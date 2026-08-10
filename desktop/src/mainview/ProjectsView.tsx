import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Brain, Check, FolderOpen, MessageSquare, Plus, Search, Trash2 } from "lucide-react";
import type { MemorySettingsState, RuntimeSnapshot } from "../shared/contracts";
import { rpc } from "./bridge";
import { filterProjects, projectThreadsFor } from "./projects-ui";
import { relativeTime } from "./ui-helpers";

type ProjectsViewProps = {
  snapshot: RuntimeSnapshot;
  onCreateChat: (projectId: string) => void;
  onSelectThread: (threadId: string) => void;
  onOpenMemory: (projectId: string) => void;
};

export function ProjectsView({ snapshot, onCreateChat, onSelectThread, onOpenMemory }: ProjectsViewProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [confirmForget, setConfirmForget] = useState(false);
  const [memory, setMemory] = useState<MemorySettingsState | null>(null);
  const [memoryError, setMemoryError] = useState(false);
  const selected = snapshot.projects.find((project) => project.id === selectedProjectId) ?? null;

  useEffect(() => {
    if (selectedProjectId && !snapshot.projects.some((project) => project.id === selectedProjectId)) setSelectedProjectId(null);
  }, [selectedProjectId, snapshot.projects]);
  useEffect(() => {
    if (!selected) { setMemory(null); return; }
    let active = true;
    setMemoryError(false);
    void rpc.request["memory.get"]({ scope: { kind: "project", projectId: selected.id } })
      .then((state) => { if (active) setMemory(state); })
      .catch(() => { if (active) setMemoryError(true); });
    return () => { active = false; };
  }, [selected?.id]);

  const projectThreads = useMemo(() => selected ? projectThreadsFor(snapshot.threads, selected.id) : [], [selected, snapshot.threads]);
  const filtered = useMemo(() => filterProjects(snapshot.projects, query), [query, snapshot.projects]);
  const selectedMemory = memory?.scopes.find((scope) => scope.key === `project:${selected?.id}`);

  if (selected) return <section className="view active"><div className="page-narrow projects-page project-detail-page">
    <button className="project-back" type="button" onClick={() => { setSelectedProjectId(null); setConfirmForget(false); }}><ArrowLeft size={15} /> All projects</button>
    <header className="project-detail-hero">
      <span className="project-detail-icon"><FolderOpen size={22} /></span>
      <div className="project-detail-title"><span className="caption-uppercase">{selected.availability === "ready" ? "Connected project" : "Folder unavailable"}</span><h1>{selected.name}</h1><p title={selected.rootPath}>{selected.rootPath}</p></div>
      <div className="project-detail-actions">{selected.availability === "ready" ? <button className="btn-outline sm" type="button" onClick={() => void rpc.request["projects.open"]({ projectId: selected.id })}>Open folder</button> : <button className="btn-outline sm" type="button" onClick={() => void rpc.request["projects.reconnect"]({ projectId: selected.id })}>Reconnect</button>}<button className="btn-primary sm" type="button" disabled={selected.availability !== "ready" || snapshot.activeRun !== null} onClick={() => onCreateChat(selected.id)}><Plus size={14} /> New chat</button></div>
    </header>

    {selected.availability === "missing" && <div className="project-warning"><strong>Proteus cannot reach this folder.</strong><span>Reconnect it before starting a new chat. Existing conversation history remains available.</span></div>}

    <div className="project-detail-grid">
      <section className="card project-conversations-card"><header><div><span className="settings-eyebrow">Conversations</span><h2>Recent chats</h2></div><span>{projectThreads.length}</span></header><div className="project-thread-list">{projectThreads.slice(0, 12).map((thread) => <button type="button" key={thread.id} onClick={() => onSelectThread(thread.id)}><span className={`project-thread-state ${thread.activity}`}><MessageSquare size={14} /></span><span><strong>{thread.title}</strong><small>{relativeTime(thread.updatedAt)} · {thread.activity}</small></span>{thread.attention > 0 && <b>{thread.attention}</b>}</button>)}{projectThreads.length === 0 && <div className="project-section-empty"><MessageSquare size={20} /><strong>No project chats yet</strong><p>Start a conversation and Proteus will keep its tools anchored to this folder.</p></div>}</div></section>

      <aside className="project-detail-aside">
        <section className="card project-memory-card"><header><span className="project-detail-mini-icon"><Brain size={16} /></span><div><span className="settings-eyebrow">Project memory</span><h2>{selectedMemory?.entries.length ?? 0} saved items</h2></div></header>{memoryError ? <p className="settings-note error">Memory preview unavailable.</p> : selectedMemory?.entries.length ? <ul>{selectedMemory.entries.slice(0, 3).map((entry) => <li key={entry.id}><Check size={12} /><span>{entry.content}</span></li>)}</ul> : <p>No durable context has been saved for this project.</p>}<button className="btn-outline sm" type="button" onClick={() => onOpenMemory(selected.id)}>Review memory</button></section>
        <section className="card project-about-card"><span className="settings-eyebrow">Project details</span><dl><div><dt>Added</dt><dd>{new Date(selected.createdAt).toLocaleDateString()}</dd></div><div><dt>Last opened</dt><dd>{relativeTime(selected.lastOpenedAt)}</dd></div><div><dt>Status</dt><dd>{selected.availability === "ready" ? "Ready" : "Needs reconnection"}</dd></div></dl><button className="btn-danger-ghost" type="button" onClick={() => setConfirmForget(true)}><Trash2 size={14} /> Forget project</button></section>
      </aside>
    </div>

    {confirmForget && <div className="modal-backdrop" role="presentation"><section className="modal-card project-forget-modal" role="dialog" aria-modal="true" aria-labelledby="project-forget-title"><span className="caption-uppercase">Remove from Proteus</span><h2 id="project-forget-title">Forget {selected.name}?</h2><p>The folder and chat history stay on your computer. Proteus removes the project connection and archives its project memory so it is not injected into future chats.</p><div className="modal-actions"><button className="btn-outline" type="button" onClick={() => setConfirmForget(false)}>Cancel</button><button className="btn-danger" type="button" onClick={() => { setConfirmForget(false); void rpc.request["projects.remove"]({ projectId: selected.id }); }}>Forget project</button></div></section></div>}
  </div></section>;

  return <section className="view active"><div className="page-narrow projects-page">
    <header className="projects-library-head"><div><span className="caption-uppercase">Your contexts</span><h1>Projects</h1><p>Give ongoing work a stable folder, its own conversations, and memory you control.</p></div><button className="btn-primary sm" type="button" onClick={() => void rpc.request["projects.attach"]()}><Plus size={15} /> Attach folder</button></header>
    <div className="projects-library-toolbar"><label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" aria-label="Search projects" /></label><span>{filtered.length} {filtered.length === 1 ? "project" : "projects"}</span></div>
    {snapshot.projects.length === 0 ? <div className="empty-page-card"><span className="empty-page-icon"><FolderOpen size={24} /></span><h2>No projects attached</h2><p>Attach a folder to give Proteus a trusted place to read, search, and work. Chats can still use the private app workspace.</p><button className="btn-outline sm" type="button" onClick={() => void rpc.request["projects.attach"]()}><Plus size={15} /> Attach your first folder</button></div> : filtered.length === 0 ? <div className="projects-no-results"><Search size={20} /><strong>No matching projects</strong><button type="button" onClick={() => setQuery("")}>Clear search</button></div> : <div className="project-library-grid">{filtered.map((project) => {
      const chats = snapshot.threads.filter((thread) => thread.workspace.binding.kind === "project" && thread.workspace.binding.projectId === project.id);
      return <button type="button" className="project-library-card" key={project.id} onClick={() => setSelectedProjectId(project.id)}><span className="project-library-icon"><FolderOpen size={19} /></span><span className="project-library-copy"><span className="project-library-status"><i className={project.availability} />{project.availability === "ready" ? "Ready" : "Reconnect folder"}</span><strong>{project.name}</strong><small title={project.rootPath}>{project.rootPath}</small></span><footer><span>{chats.length} {chats.length === 1 ? "chat" : "chats"}</span><time>{relativeTime(project.lastOpenedAt)}</time></footer></button>;
    })}</div>}
  </div></section>;
}
