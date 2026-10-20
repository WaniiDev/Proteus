import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, Brain, ChevronRight, Folder, Plus, Sparkles, TriangleAlert } from "lucide-react";
import type { MemorySettingsState, RuntimeSnapshot } from "../../shared/contracts";
import { EmptyState } from "../components/ds/EmptyState";
import { Modal } from "../components/ds/Modal";
import { useToast } from "../components/ds/Toast";
import { useViewSwap } from "../ds-app/useViewSwap";
import { rpc } from "../lib/bridge";
import { activityDotClass, chatCountLabel, projectThreadsFor } from "../lib/projects-ui";
import { relativeTime, shortDate } from "../lib/ui-helpers";

type WorkspaceSkill = { name: string; description: string; path: string; source: string; conflict: boolean };

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
  const [skills, setSkills] = useState<WorkspaceSkill[] | null>(null);
  const [skillsError, setSkillsError] = useState(false);
  // Opening a project and going back is a two-beat swap inside the page: the list fades up, then the next rows rise in.
  const { shown: shownProjectId, leaving } = useViewSwap(selectedProjectId);
  const selected = snapshot.projects.find((project) => project.id === shownProjectId) ?? null;
  const toast = useToast();
  const scroller = useRef<HTMLElement>(null);
  useEffect(() => { scroller.current?.scrollTo?.({ top: 0 }); }, [shownProjectId]);
  // Rows rise in with a stagger that carries on across the page's lists (the DS staggers within one list).
  let rowIndex = 0;
  const rise = (): CSSProperties => ({ ["--i" as string]: Math.min(rowIndex++, 6) });
  const body = leaving ? "projects-body is-leaving" : "projects-body";

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

  // workspace.skills reads the workspace the active conversation is bound to, so a project lists its skills
  // while a chat in that project is the active one.
  const skillsProjectId = selected && snapshot.activeWorkspace.binding.kind === "project" && snapshot.activeWorkspace.binding.projectId === selected.id && snapshot.activeWorkspace.availability === "ready" ? selected.id : null;
  useEffect(() => {
    setSkills(null); setSkillsError(false);
    if (!skillsProjectId) return;
    let active = true;
    void rpc.request["workspace.skills"]({})
      .then((list: WorkspaceSkill[]) => { if (active) setSkills(list); })
      .catch(() => { if (active) setSkillsError(true); });
    return () => { active = false; };
  }, [skillsProjectId]);

  const projectThreads = useMemo(() => selected ? projectThreadsFor(snapshot.threads, selected.id) : [], [selected, snapshot.threads]);
  const selectedMemory = memory?.scopes.find((scope) => scope.key === `project:${selected?.id}`);
  const attach = () => void rpc.request["projects.attach"]();

  if (selected) {
    const ready = selected.availability === "ready";
    const memoryCount = memoryError ? "Unavailable" : selectedMemory ? `${selectedMemory.entries.length} saved ${selectedMemory.entries.length === 1 ? "item" : "items"}` : "";
    return <section className="projects-view" ref={scroller}><div className={`page ${body}`}>
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
          {projectThreads.map((thread) => <button type="button" className="list-row enter" style={rise()} key={thread.id} onClick={() => onSelectThread(thread.id)}>
            <span className={activityDotClass(thread.activity)} aria-hidden="true" />
            <span className="row-copy"><span className="row-title">{thread.title}</span></span>
            <span className="row-end">{relativeTime(thread.updatedAt)}<ChevronRight className="i sm" aria-hidden="true" /></span>
          </button>)}
          {projectThreads.length === 0 && <div className="list-row quiet enter" style={rise()}>No chats here yet. Start one and Proteus works inside this folder.</div>}
        </div>
      </div>
      <div className="list-group"><span className="list-label kicker">Skills</span>
        <div className="list">
          {skills?.map((skill) => <div className="list-row enter" style={rise()} key={`${skill.source}:${skill.name}`}>
            <Sparkles className="i" aria-hidden="true" />
            <span className="row-copy"><span className="row-title">{skill.name}</span><span className="row-sub" title={skill.path}>{skill.description}</span></span>
            {skill.conflict && <span className="row-end"><span className="badge warn">Conflict</span></span>}
          </div>)}
          {skills?.length === 0 && <div className="list-row quiet enter" style={rise()}>No skills found in this folder.</div>}
          {skills === null && <div className="list-row quiet enter" style={rise()} role={skillsError ? "alert" : undefined}>{skillsError ? "Skills could not be loaded." : skillsProjectId ? "Loading skills…" : "Open a chat here to list this folder’s skills."}</div>}
        </div>
      </div>
      <div className="list-group"><span className="list-label kicker">This project</span>
        <div className="list">
          <button type="button" className="list-row enter" style={rise()} onClick={() => onOpenMemory(selected.id)}>
            <Brain className="i" aria-hidden="true" />
            <span className="row-copy"><span className="row-title">Project memory</span><span className="row-sub">Kept for this folder only</span></span>
            <span className="row-end">{memoryCount}<ChevronRight className="i sm" aria-hidden="true" /></span>
          </button>
          <div className="list-row enter" style={rise()}><span className="row-copy"><span className="row-title">Added</span></span><span className="row-end">{shortDate(selected.createdAt)}</span></div>
          <div className="list-row enter" style={rise()}><span className="row-copy"><span className="row-title">Last opened</span></span><span className="row-end">{shortDate(selected.lastOpenedAt)}</span></div>
        </div>
      </div>
      <div className="list-group">
        <div className="list"><button type="button" className="list-row danger enter" style={rise()} onClick={() => setConfirmForget(true)}>Forget project</button></div>
        <p className="list-note">Removes it from Proteus with its project memory. The folder stays on disk.</p>
      </div>
      {confirmForget && <Modal title="Forget this project?" confirmLabel="Forget project" onCancel={() => setConfirmForget(false)} onConfirm={() => {
        setConfirmForget(false);
        void rpc.request["projects.remove"]({ projectId: selected.id })
          .then((result: { accepted: boolean } | undefined) => { if (result?.accepted !== false) toast(`Forgot ${selected.name}`, "The folder is still on disk. Its project memory was cleared."); })
          .catch(() => undefined);
      }}>
        <strong className="modal-name">{selected.name}</strong> will be removed from Proteus along with its project memory. The folder and its files stay on disk.
      </Modal>}
    </div></section>;
  }

  const empty = snapshot.projects.length === 0;
  return <section className="projects-view" ref={scroller}><div className={`page ${body}`}>
    <div className="page-head">
      <div><h1 className="heading">Projects</h1><p>Folders Proteus can read and search. Anything that writes still asks you first.</p></div>
      {!empty && <button className="btn btn-secondary sm" type="button" onClick={attach}><Plus className="i sm" aria-hidden="true" />Attach folder</button>}
    </div>
    {empty
      ? <EmptyState title="No projects yet" action={<button className="btn btn-primary sm" type="button" onClick={attach}><Plus className="i sm" aria-hidden="true" />Attach folder</button>}>Attach a folder and Proteus can read and search it. Chats use the private Proteus workspace until you do.</EmptyState>
      : <div className="list">{snapshot.projects.map((project) => {
        const count = snapshot.threads.filter((thread) => thread.workspace.binding.kind === "project" && thread.workspace.binding.projectId === project.id).length;
        return <button type="button" className="list-row enter" style={rise()} key={project.id} onClick={() => setSelectedProjectId(project.id)}>
          <Folder className="i" aria-hidden="true" />
          <span className="row-copy"><span className="row-title">{project.name}</span><span className="row-sub mono" title={project.rootPath}>{project.rootPath}</span></span>
          <span className="row-end">{project.availability === "missing" ? <><span className="dot warn" role="img" aria-label="Folder unavailable" />Reconnect</> : chatCountLabel(count)}<ChevronRight className="i sm" aria-hidden="true" /></span>
        </button>;
      })}</div>}
  </div></section>;
}
