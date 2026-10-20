import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, Folder, Lock } from "lucide-react";
import type { ProviderModelId, ReasoningEffort, RuntimeSnapshot, WorkspaceBinding, WorkspaceBindingUpdateResult } from "../../../shared/contracts";
import { deriveContextChips } from "../../lib/composer-ui";
import { sortProviderModels } from "../../lib/model-sorting";
import { ProviderMark } from "../ProviderMark";
import { EffortPicker, ModelPicker, type EffortControl } from "./ModelPicker";
import { ProjectPicker } from "./ProjectPicker";

export type ContextChipsProps = {
  snapshot: RuntimeSnapshot;
  queuedDraftCount: number;
  runningElsewhere: boolean;
  /** An ask is open: the model chip is disabled. */
  askOpen: boolean;
  onWorkspaceSelect: (binding: WorkspaceBinding) => Promise<WorkspaceBindingUpdateResult>;
  onModelSelect: (modelId: ProviderModelId) => Promise<boolean>;
  onReasoningSelect: (effort: ReasoningEffort | null) => Promise<boolean>;
  /** Settings › Providers: the warn chip and a provider that isn't connected. */
  onProviders: () => void;
  /** Settings › Models. */
  onModels: () => void;
  onProjects?: () => void;
  /** Fired once each time thinking arrives at the model's top level. */
  onTopLevel?: () => void;
};

type Pop = "project" | "model" | "effort" | null;
/** A picked model closes the picker after its check has landed. */
export const PICK_CLOSE_MS = 220;

const sameBinding = (left: WorkspaceBinding, right: WorkspaceBinding) =>
  left.kind === right.kind && (left.kind === "app" || (right.kind === "project" && left.projectId === right.projectId));

/** The chips under the Island (`.island-meta`) and the pickers they open (`.island-anchor`). */
export function ContextChips({ snapshot, queuedDraftCount, runningElsewhere, askOpen, onWorkspaceSelect, onModelSelect, onReasoningSelect, onProviders, onModels, onProjects, onTopLevel }: ContextChipsProps) {
  const chipsRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLButtonElement>(null);
  const modelRef = useRef<HTMLButtonElement>(null);
  const effortRef = useRef<HTMLButtonElement>(null);
  const [pop, setPop] = useState<Pop>(null);
  const [browseProviderId, setBrowseProviderId] = useState<string>(snapshot.selectedProviderId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [effortOverride, setEffortOverride] = useState<ReasoningEffort | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const chips = deriveContextChips({ snapshot, queuedDraftCount, runningElsewhere, askOpen, effortOverride });
  useEffect(() => setEffortOverride(null), [snapshot.selectedReasoningEffort, snapshot.selectedModelId]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const popRef = useRef<Pop>(null);
  popRef.current = pop;
  const close = useCallback((restoreFocus: boolean) => {
    clearTimeout(closeTimer.current);
    const was = popRef.current;
    setPop(null);
    if (was && restoreFocus) requestAnimationFrame(() => (was === "project" ? projectRef : was === "model" ? modelRef : effortRef).current?.focus({ preventScroll: true }));
  }, []);

  // A picker can't outlive its chip: an ask, a run or a started conversation closes it.
  useEffect(() => {
    if ((pop === "project" && (chips.projectLocked || !chips.showProject)) || (pop && pop !== "project" && chips.modelLocked) || (pop === "effort" && !chips.levels.length)) setPop(null);
  }, [pop, chips.projectLocked, chips.showProject, chips.modelLocked, chips.levels.length]);

  const toggle = (which: Exclude<Pop, null>) => {
    setError(null);
    if (which === "model") setBrowseProviderId(chips.providerId);
    setPop((current) => (current === which ? null : which));
  };
  const chipKey = (event: ReactKeyboardEvent<HTMLElement>, which: Exclude<Pop, null>, locked: boolean) => {
    if (event.key === "ArrowUp" && pop !== which && !locked) {
      event.preventDefault();
      toggle(which);
    } else if (event.key === "Escape" && pop) {
      event.preventDefault();
      close(true);
    }
  };

  const run = async (action: () => Promise<boolean>, failure: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const ok = await action();
      if (!ok) setError(failure);
      return ok;
    } catch {
      setError(failure);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const selectWorkspace = async (binding: WorkspaceBinding) => {
    if (sameBinding(binding, snapshot.activeWorkspace.binding)) return close(true);
    setBusy(true);
    setError(null);
    try {
      const result = await onWorkspaceSelect(binding);
      if (result.accepted) close(true);
      else setError(result.message);
    } catch {
      setError("The project selection could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const selectModel = async (modelId: ProviderModelId) => {
    if (modelId === snapshot.selectedModelId) return;
    const ok = await run(() => onModelSelect(modelId), "The model selection could not be saved.");
    if (ok) {
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => close(true), PICK_CLOSE_MS);
    }
  };

  const selectEffort = (level: ReasoningEffort) => {
    setEffortOverride(level);
    void run(() => onReasoningSelect(level), "The thinking effort could not be saved.").then((ok) => { if (!ok) setEffortOverride(null); });
  };

  const model = snapshot.models.find((candidate) => candidate.id === snapshot.selectedModelId);
  const effort: EffortControl | null = chips.levels.length ? { modelName: chips.modelName, levels: chips.levels, value: chips.effort, onChange: selectEffort, onTopLevel } : null;
  const browsedModels = sortProviderModels(snapshot.models.filter((candidate) => candidate.providerId === browseProviderId), "recommended", snapshot.selectedModelId);

  return (
    <>
      <div className="island-anchor">
        <ProjectPicker open={pop === "project"} chipsRef={chipsRef} onDismiss={close} active={snapshot.activeWorkspace.binding} projects={snapshot.projects} busy={busy} error={error} onSelect={(binding) => void selectWorkspace(binding)} onProjects={onProjects ? () => { close(false); onProjects(); } : undefined} />
        <ModelPicker
          open={pop === "model"}
          chipsRef={chipsRef}
          onDismiss={close}
          providers={snapshot.providers}
          browseProviderId={browseProviderId}
          onBrowse={(providerId) => { setBrowseProviderId(providerId); setError(null); }}
          models={browsedModels}
          selectedModelId={snapshot.selectedModelId}
          busy={busy}
          running={snapshot.activeRun !== null}
          error={error}
          onPick={(modelId) => void selectModel(modelId)}
          effort={effort && model?.providerId === browseProviderId ? effort : null}
          onConnect={() => { close(false); onProviders(); }}
          onManage={() => { close(false); onModels(); }}
        />
        {effort && <EffortPicker open={pop === "effort"} chipsRef={chipsRef} onDismiss={close} effort={effort} />}
      </div>
      <div ref={chipsRef} className="island-meta" aria-label="Conversation context">
        {chips.showProject && (
          <button
            ref={projectRef}
            type="button"
            className="island-chip"
            aria-haspopup="dialog"
            aria-expanded={pop === "project"}
            aria-disabled={chips.projectLocked || undefined}
            aria-label={chips.projectAria}
            title={chips.projectTitle}
            onClick={() => { if (!chips.projectLocked) toggle("project"); }}
            onKeyDown={(event) => chipKey(event, "project", chips.projectLocked)}
          >
            <Folder className="i" aria-hidden="true" />
            <span className="chip-label">{chips.projectLabel}</span>
            {chips.projectLocked ? <Lock className="i" aria-hidden="true" /> : <ChevronDown className="i chip-caret" aria-hidden="true" />}
          </button>
        )}
        {chips.needsConnect ? (
          <button
            ref={modelRef}
            type="button"
            className="island-chip is-warn"
            aria-haspopup="dialog"
            aria-expanded={pop === "model"}
            aria-label={`Connect ${chips.providerName}. Choose how in the model picker.`}
            title={chips.modelTitle}
            aria-disabled={chips.modelLocked || undefined}
            onClick={() => { if (!chips.modelLocked) toggle("model"); }}
            onKeyDown={(event) => chipKey(event, "model", chips.modelLocked)}
          >
            <span className="dot warn" />
            <span className="chip-label">Connect {chips.providerName}</span>
            <ChevronDown className="i chip-caret" aria-hidden="true" />
          </button>
        ) : (
          <div className="island-chip split" role="group" aria-label="Model and thinking" aria-disabled={chips.modelLocked || undefined} title={chips.modelTitle}>
            <button
              ref={modelRef}
              type="button"
              className="chip-part"
              aria-haspopup="dialog"
              aria-expanded={pop === "model"}
              aria-disabled={chips.modelLocked || undefined}
              aria-label={chips.modelAria}
              onClick={() => { if (!chips.modelLocked) toggle("model"); }}
              onKeyDown={(event) => chipKey(event, "model", chips.modelLocked)}
            >
              <ProviderMark provider={chips.providerId} />
              <span className="chip-label">{chips.modelName}</span>
            </button>
            {chips.levels.length > 0 && (
              <>
                <span className="chip-divider" aria-hidden="true" />
                <button
                  ref={effortRef}
                  type="button"
                  className="chip-part chip-effort"
                  aria-haspopup="dialog"
                  aria-expanded={pop === "effort"}
                  aria-disabled={chips.modelLocked || undefined}
                  aria-label={chips.effortAria}
                  onClick={() => { if (!chips.modelLocked) toggle("effort"); }}
                  onKeyDown={(event) => chipKey(event, "effort", chips.modelLocked)}
                >
                  <span className={`effort-meter m-${chips.meter}${chips.atTop ? " is-max" : ""}`} aria-hidden="true"><i /><i /><i /><i /></span>
                  <span className="chip-label">{chips.effortLabel}</span>
                  <ChevronDown className="i chip-caret" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
