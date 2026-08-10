import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Brain, Check, ChevronDown, FolderOpen, Search, Send, Settings2, Square } from "lucide-react";
import type {
  ProviderModelId,
  ReasoningEffort,
  RuntimeSnapshot,
  WorkspaceBinding,
  WorkspaceBindingUpdateResult,
} from "../shared/contracts";
import {
  canChooseComposerWorkspace,
  composerAction,
  composerLineCount,
  composerModelLabel,
  shouldSubmitComposerKey,
} from "./composer-ui";

type ComposerProps = {
  snapshot: RuntimeSnapshot;
  input: string;
  queuedDraftCount: number;
  canChat: boolean;
  runningForSelected: boolean;
  runningElsewhere: boolean;
  providerName: string;
  onInput: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onAbort: () => void;
  onSettings: () => void;
  onNudge: () => void;
  onWorkspaceSelect: (binding: WorkspaceBinding) => Promise<WorkspaceBindingUpdateResult>;
  onModelSelect: (modelId: ProviderModelId) => Promise<boolean>;
  onReasoningSelect: (effort: ReasoningEffort | null) => Promise<boolean>;
};

type OpenMenu = "project" | "model" | null;

function sameBinding(left: WorkspaceBinding, right: WorkspaceBinding): boolean {
  return left.kind === right.kind && (left.kind === "app" || (right.kind === "project" && left.projectId === right.projectId));
}

function moveMenuFocus(event: ReactKeyboardEvent<HTMLElement>, selector: string, horizontal = false): void {
  const previousKey = horizontal ? "ArrowLeft" : "ArrowUp";
  const nextKey = horizontal ? "ArrowRight" : "ArrowDown";
  if (![previousKey, nextKey, "Home", "End"].includes(event.key)) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(selector)].filter((item) => !item.disabled);
  if (!items.length) return;
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? items.length - 1
      : event.key === previousKey
        ? (currentIndex <= 0 ? items.length - 1 : currentIndex - 1)
        : (currentIndex + 1) % items.length;
  event.preventDefault();
  items[nextIndex]?.focus();
  if (horizontal) items[nextIndex]?.click();
}

export function Composer({
  snapshot,
  input,
  queuedDraftCount,
  canChat,
  runningForSelected,
  runningElsewhere,
  providerName,
  onInput,
  onSubmit,
  onAbort,
  onSettings,
  onNudge,
  onWorkspaceSelect,
  onModelSelect,
  onReasoningSelect,
}: ComposerProps) {
  const rootRef = useRef<HTMLFormElement>(null);
  const projectTriggerRef = useRef<HTMLButtonElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [browseProviderId, setBrowseProviderId] = useState(snapshot.selectedProviderId);
  const [modelSearch, setModelSearch] = useState("");
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const showProjectControl = canChooseComposerWorkspace(snapshot, queuedDraftCount);
  const selectedModel = snapshot.models.find((model) => model.id === snapshot.selectedModelId);
  const primaryAction = composerAction(runningForSelected, input.trim().length > 0);
  const inputLineCount = composerLineCount(input);
  const controlsDisabled = selectionBusy || snapshot.activeRun !== null || runningElsewhere;

  useEffect(() => {
    if (!showProjectControl && openMenu === "project") setOpenMenu(null);
  }, [openMenu, showProjectControl]);

  useEffect(() => {
    if (openMenu !== "model") return;
    setBrowseProviderId(selectedModel?.providerId ?? snapshot.selectedProviderId);
    setSelectionError(null);
  }, [openMenu, selectedModel?.providerId, snapshot.selectedProviderId]);

  useEffect(() => {
    if (!openMenu) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const menu = openMenu;
      setOpenMenu(null);
      requestAnimationFrame(() => (menu === "project" ? projectTriggerRef.current : modelTriggerRef.current)?.focus());
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  const displayedModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return snapshot.models.filter((model) => {
      if (model.providerId !== browseProviderId) return false;
      return !query || `${model.name} ${model.baseModelId ?? model.rawId}`.toLowerCase().includes(query);
    });
  }, [browseProviderId, modelSearch, snapshot.models]);

  const selectWorkspace = async (binding: WorkspaceBinding) => {
    if (sameBinding(binding, snapshot.activeWorkspace.binding)) {
      setOpenMenu(null);
      return;
    }
    setSelectionBusy(true);
    setSelectionError(null);
    try {
      const result = await onWorkspaceSelect(binding);
      if (result.accepted) setOpenMenu(null);
      else setSelectionError(result.message);
    } catch {
      setSelectionError("The project selection could not be saved.");
    } finally {
      setSelectionBusy(false);
    }
  };

  const selectModel = async (modelId: ProviderModelId) => {
    setSelectionBusy(true);
    setSelectionError(null);
    try {
      if (!(await onModelSelect(modelId))) setSelectionError("The model selection could not be saved.");
    } catch {
      setSelectionError("The model selection could not be saved.");
    } finally {
      setSelectionBusy(false);
    }
  };

  const selectReasoning = async (effort: ReasoningEffort) => {
    setSelectionBusy(true);
    setSelectionError(null);
    try {
      if (!(await onReasoningSelect(effort))) setSelectionError("The thinking effort could not be saved.");
    } catch {
      setSelectionError("The thinking effort could not be saved.");
    } finally {
      setSelectionBusy(false);
    }
  };

  const browsedProvider = snapshot.providers.find((provider) => provider.id === browseProviderId);
  const reasoningOptions = selectedModel?.providerId === browseProviderId ? selectedModel.reasoningOptions ?? [] : [];

  return (
    <form ref={rootRef} className="composer composer-claude" onSubmit={onSubmit} autoComplete="off">
      <textarea
        className="composer-input"
        value={input}
        onChange={(event) => {
          onInput(event.target.value);
          onNudge();
        }}
        placeholder={runningElsewhere ? "Another conversation is running…" : canChat ? "Message Proteus…" : `Configure ${providerName} in Settings to chat`}
        aria-label="Message Proteus"
        disabled={!canChat}
        maxLength={32_000}
        rows={inputLineCount}
        onKeyDown={(event) => {
          if (!shouldSubmitComposerKey({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing })) return;
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
      />

      <div className="composer-footer">
        <div className="composer-controls">
          {showProjectControl && (
            <div className="composer-control-wrap">
              <button
                ref={projectTriggerRef}
                className="composer-pill"
                type="button"
                disabled={controlsDisabled}
                aria-haspopup="menu"
                aria-expanded={openMenu === "project"}
                onClick={() => {
                  setSelectionError(null);
                  setOpenMenu((current) => current === "project" ? null : "project");
                }}
              >
                <FolderOpen size={14} />
                <span>{snapshot.activeWorkspace.label}</span>
                <ChevronDown size={13} />
              </button>
              {openMenu === "project" && (
                <div className="composer-popover composer-project-popover" role="menu" aria-label="Choose project">
                  <div className="composer-popover-head"><strong>Choose project</strong><small>Available until the first message</small></div>
                  <div className="composer-option-list" onKeyDown={(event) => moveMenuFocus(event, '[role="menuitemradio"]')}>
                    <button type="button" role="menuitemradio" aria-checked={snapshot.activeWorkspace.binding.kind === "app"} disabled={selectionBusy} onClick={() => void selectWorkspace({ kind: "app" })}>
                      <span><strong>Proteus workspace</strong><small>Private app workspace</small></span>
                      {snapshot.activeWorkspace.binding.kind === "app" && <Check size={15} />}
                    </button>
                    {snapshot.projects.map((project) => {
                      const selected = snapshot.activeWorkspace.binding.kind === "project" && snapshot.activeWorkspace.binding.projectId === project.id;
                      return (
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          key={project.id}
                          disabled={selectionBusy || project.availability !== "ready"}
                          onClick={() => void selectWorkspace({ kind: "project", projectId: project.id })}
                        >
                          <span><strong>{project.name}</strong><small>{project.availability === "ready" ? project.rootPath : "Reconnect in Projects"}</small></span>
                          {selected && <Check size={15} />}
                        </button>
                      );
                    })}
                  </div>
                  {selectionError && <p className="composer-popover-error" role="alert">{selectionError}</p>}
                </div>
              )}
            </div>
          )}

          <div className="composer-control-wrap composer-model-control">
            <button
              ref={modelTriggerRef}
              className="composer-pill composer-model-pill"
              type="button"
              disabled={controlsDisabled}
              aria-haspopup="dialog"
              aria-expanded={openMenu === "model"}
              title={composerModelLabel(snapshot)}
              onClick={() => setOpenMenu((current) => current === "model" ? null : "model")}
            >
              <Brain size={14} />
              <span>{composerModelLabel(snapshot)}</span>
              <ChevronDown size={13} />
            </button>
            {openMenu === "model" && (
              <div className="composer-popover composer-model-popover" role="dialog" aria-label="Choose provider, model, and thinking effort">
                <div className="composer-popover-head"><strong>Model & thinking</strong><small>Saved for this conversation</small></div>
                <div className="composer-provider-tabs" role="tablist" aria-label="Providers" onKeyDown={(event) => moveMenuFocus(event, '[role="tab"]', true)}>
                  {snapshot.providers.map((provider) => (
                    <button type="button" role="tab" aria-selected={browseProviderId === provider.id} className={browseProviderId === provider.id ? "active" : ""} key={provider.id} onClick={() => { setBrowseProviderId(provider.id); setModelSearch(""); setSelectionError(null); }}>
                      {provider.name}
                      <i className={provider.availability} />
                    </button>
                  ))}
                </div>

                {browsedProvider?.verified && browsedProvider.availability === "ready" ? (
                  <>
                    <label className="composer-model-search"><Search size={14} /><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search models" aria-label="Search models" /></label>
                    <div className="composer-model-list" role="listbox" aria-label={`${browsedProvider.name} models`} onKeyDown={(event) => moveMenuFocus(event, '[role="option"]')}>
                      {displayedModels.map((model) => (
                        <button type="button" role="option" aria-selected={model.id === snapshot.selectedModelId} className={model.id === snapshot.selectedModelId ? "selected" : ""} key={model.id} disabled={selectionBusy} onClick={() => void selectModel(model.id)}>
                          <span><strong>{model.name}</strong><small>{model.description ?? model.rawId}</small></span>
                          {model.id === snapshot.selectedModelId && <Check size={15} />}
                        </button>
                      ))}
                      {displayedModels.length === 0 && <p className="composer-model-empty">No matching models.</p>}
                    </div>
                    <section className="composer-thinking">
                      <div><span>Thinking</span><strong>{reasoningOptions.length ? "Reasoning effort" : "Provider default"}</strong></div>
                      {reasoningOptions.length > 0 && (
                        <div className="composer-thinking-options">
                          {reasoningOptions.map((effort) => <button type="button" className={snapshot.selectedReasoningEffort === effort ? "active" : ""} key={effort} disabled={selectionBusy} onClick={() => void selectReasoning(effort)}>{effort}</button>)}
                        </div>
                      )}
                    </section>
                  </>
                ) : (
                  <div className="composer-provider-empty">
                    <Settings2 size={21} />
                    <strong>Connect {browsedProvider?.name ?? "this provider"}</strong>
                    <p>Configure this provider before choosing one of its models.</p>
                    <button type="button" onClick={() => { setOpenMenu(null); onSettings(); }}>Configure in Settings</button>
                  </div>
                )}
                {selectionError && <p className="composer-popover-error" role="alert">{selectionError}</p>}
                <button className="composer-manage-models" type="button" onClick={() => { setOpenMenu(null); onSettings(); }}><Settings2 size={13} /> Manage models in Settings</button>
              </div>
            )}
          </div>
        </div>

        <span className="composer-hint">Enter to send · Shift+Enter for new line</span>
        {primaryAction === "stop" ? (
          <button className="composer-primary composer-primary-stop" type="button" aria-label="Stop response" onClick={onAbort}><Square size={17} /></button>
        ) : (
          <button className="composer-primary" type="submit" aria-label={primaryAction === "queue" ? "Queue message" : "Send"} disabled={!canChat || !input.trim()}><Send size={18} /></button>
        )}
      </div>
    </form>
  );
}
