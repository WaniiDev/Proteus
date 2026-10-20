import { ChevronRight, Folder } from "lucide-react";
import type { ProjectSummary, WorkspaceBinding } from "../../../shared/contracts";
import { PickerShell, type PickerShellProps } from "./PickerShell";

export type ProjectPickerProps = Pick<PickerShellProps, "open" | "chipsRef" | "onDismiss"> & {
  active: WorkspaceBinding;
  projects: readonly ProjectSummary[];
  busy: boolean;
  error: string | null;
  onSelect: (binding: WorkspaceBinding) => void;
  onProjects?: () => void;
};

const CHECK = (
  <svg className="i sm row-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
);

/** Where Proteus works: the app workspace and the attached projects, as a radio group. */
export function ProjectPicker({ open, chipsRef, onDismiss, active, projects, busy, error, onSelect, onProjects }: ProjectPickerProps) {
  return (
    <PickerShell open={open} label="Choose where Proteus works" from="from-start" chipsRef={chipsRef} onDismiss={onDismiss}>
      <div className="picker-head"><span className="kicker">Work in</span></div>
      <div role="radiogroup" aria-label="Project" className="picker-group">
        <button type="button" className="picker-option" role="radio" aria-checked={active.kind === "app"} disabled={busy} onClick={() => onSelect({ kind: "app" })}>
          <Folder className="i" aria-hidden="true" />
          <span><strong>Proteus workspace</strong><small>Private app workspace</small></span>
          {CHECK}
        </button>
        {projects.map((project) => (
          <button
            type="button"
            className="picker-option"
            role="radio"
            key={project.id}
            aria-checked={active.kind === "project" && active.projectId === project.id}
            disabled={busy || project.availability !== "ready"}
            onClick={() => onSelect({ kind: "project", projectId: project.id })}
          >
            <Folder className="i" aria-hidden="true" />
            <span><strong>{project.name}</strong><small>{project.availability === "ready" ? project.rootPath : "Reconnect in Projects"}</small></span>
            {CHECK}
          </button>
        ))}
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="picker-foot">
        <span>Fixed once the conversation starts.</span>
        {onProjects && <button type="button" className="btn btn-ghost sm" onClick={onProjects}>Projects<ChevronRight className="i sm" aria-hidden="true" /></button>}
      </div>
    </PickerShell>
  );
}
