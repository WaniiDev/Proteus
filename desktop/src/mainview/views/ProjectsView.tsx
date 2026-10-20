import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Brain, ChevronRight, Folder, Plus, TriangleAlert } from "lucide-react";
import type { MemorySettingsState, RuntimeSnapshot } from "../../shared/contracts";
import { EmptyState } from "../components/ds/EmptyState";
import { Modal } from "../components/ds/Modal";
import { rpc } from "../lib/bridge";
import { activityDotClass, chatCountLabel, projectThreadsFor } from "../lib/projects-ui";
import { relativeTime } from "../lib/ui-helpers";

type ProjectsViewProps = {
  snapshot: RuntimeSnapshot;
  onCreateChat: (projectId: string) => void;
  onSelectThread: (threadId: string) => void;
  onOpenMemory: (projectId: string) => void;
};

export function ProjectsView({ snapshot, onCreateChat, onSelectThread, onOpenMemory }: ProjectsViewProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
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
  const selectedMemory = memory?.scopes.find((scope) => scope.key === `project:${selected?.id}`);
  const attach = () => void rpc.request["projects.attach"]();

  if (selected) {
    const ready = selected.availability === "ready";
    const memoryCount = memoryError ? "Unavailable" : selectedMemory ? `${selectedMemory.entries.length} saved` : "";
    return <section className="view active"><div className="page">
      <button className="btn btn-ghost sm page-back" type="button" onClick={() => { setSelectedProjectId(null); setConfirmForget(false); }}><ArrowLeft className="i sm" aria-hidden="true" />Projects</button>
      <div className="page-head">
        <div><h1 className="heading project-name" title={selected.name}>{selected.name}</h1><p className="mono project-path" title={selected.rootPath}>{selected.rootPath}</p></div>
        <div className="page-actions">{ready
          ? <><button className="btn btn-secondary sm" type="button" onClick={() => void rpc.request["projects.open"]({ projectId: selected.id })}>Open folder</button><button className="btn btn-primary sm" type="button" disabled={snapshot.activeRun !== null} onClick={() => onCreateChat(selected.id)}>New chat here</button></>
          : <button className="btn btn-primary sm" type="button" onClick={() => void rpc.request["projects.reconnect"]({ projectId: selected.id })}>Reconnect</button>}</div>
      </div>
      {!ready && <div className="notice warn" role="status"><TriangleAlert className="i" aria-hidden="true" /><div><strong>Proteus can’t reach this folder.</strong><p>Reconnect it before starting a chat here. Nothing in it was changed.</p></div></div>}
      <div className="list-group"><span className="list-label kicker">Chats</span>
        <div className="list">
          {projectThreads.map((thread) => <button type="button" className="list-row" key={thread.id} onClick={() => onSelectThread(thread.id)}>
            <span className={activityDotClass(thread.activity)} aria-hidden="true" />
            <span className="row-copy"><span className="row-title">{thread.title}</span></span>
            <span className="row-end">{relativeTime(thread.updatedAt)}<ChevronRight className="i sm" aria-hidden="true" /></span>
          </button>)}
          {projectThreads.length === 0 && <div className="list-row quiet">No chats here yet. Start one and Proteus works inside this folder.</div>}
        </div>
      </div>
      <div className="list-group"><span className="list-label kicker">This project</span>
        <div className="list">
          <button type="button" className="list-row" onClick={() => onOpenMemory(selected.id)}>
            <Brain className="i" aria-hidden="true" />
            <span className="row-copy"><span className="row-title">Project memory</span><span className="row-sub">Kept for this folder only</span></span>
            <span className="row-end">{memoryCount}<ChevronRight className="i sm" aria-hidden="true" /></span>
          </button>
          <div className="list-row"><span className="row-copy"><span className="row-title">Added</span></span><span className="row-end">{new Date(selected.createdAt).toLocaleDateString()}</span></div>
          <div className="list-row"><span className="row-copy"><span className="row-title">Last opened</span></span><span className="row-end">{relativeTime(selected.lastOpenedAt)}</span></div>
        </div>
      </div>
      <div className="list-group">
        <div className="list"><button type="button" className="list-row danger" onClick={() => setConfirmForget(true)}>Forget project</button></div>
        <p className="list-note">Removes it from Proteus with its project memory. The folder stays on disk.</p>
      </div>
      {confirmForget && <Modal title="Forget this project?" confirmLabel="Forget project" onCancel={() => setConfirmForget(false)} onConfirm={() => { setConfirmForget(false); void rpc.request["projects.remove"]({ projectId: selected.id }); }}>
        <strong className="modal-name">{selected.name}</strong> will be removed from Proteus along with its project memory. The folder and its files stay on disk.
      </Modal>}
    </div></section>;
  }

  const empty = snapshot.projects.length === 0;
  return <section className="view active"><div className="page">
    <div className="page-head">
      <div><h1 className="heading">Projects</h1><p>Folders Proteus can read and search. Anything that writes still asks you first.</p></div>
      {!empty && <button className="btn btn-secondary sm" type="button" onClick={attach}><Plus className="i sm" aria-hidden="true" />Attach folder</button>}
    </div>
    {empty
      ? <EmptyState title="No projects yet" action={<button className="btn btn-primary sm" type="button" onClick={attach}><Plus className="i sm" aria-hidden="true" />Attach folder</button>}>Attach a folder and Proteus can read and search it. Chats use the private Proteus workspace until you do.</EmptyState>
      : <div className="list">{snapshot.projects.map((project) => {
        const count = snapshot.threads.filter((thread) => thread.workspace.binding.kind === "project" && thread.workspace.binding.projectId === project.id).length;
        return <button type="button" className="list-row" key={project.id} onClick={() => setSelectedProjectId(project.id)}>
          <Folder className="i" aria-hidden="true" />
          <span className="row-copy"><span className="row-title">{project.name}</span><span className="row-sub mono" title={project.rootPath}>{project.rootPath}</span></span>
          <span className="row-end">{project.availability === "missing" && <span className="dot warn" role="img" aria-label="Folder unavailable" />}{chatCountLabel(count)}<ChevronRight className="i sm" aria-hidden="true" /></span>
        </button>;
      })}</div>}
  </div></section>;
}
