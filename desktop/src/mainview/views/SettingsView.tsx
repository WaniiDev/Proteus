import { useEffect, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { ProviderId, ProviderModel, RuntimeSnapshot } from "../../shared/contracts";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { EffortSlider } from "../components/EffortSlider";
import { ProviderSelect, ProviderSettings, browsableModels } from "../components/ProviderSettings";
import { Segmented, segmentedTabId } from "../components/ds/Segmented";
import { exitMs } from "../components/ds/motion";
import { useTheme } from "../hooks/useTheme";
import { effortHint, nearestLevel, NO_ADJUSTABLE_THINKING, orderedLevels } from "../lib/effort";
import { MODEL_SORT_OPTIONS, modelSortLabel, sortProviderModels, type ModelSort } from "../lib/model-sorting";
import type { ThemeChoice } from "../lib/theme";

export type SettingsSection = "providers" | "models" | "appearance" | "developer";

const TABS: { value: SettingsSection; label: string }[] = [
  { value: "providers", label: "Providers" },
  { value: "models", label: "Models" },
  { value: "appearance", label: "Appearance" },
  { value: "developer", label: "Developer" },
];

const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Day" },
  { value: "dark", label: "Night" },
];

/** The search row appears once a catalog is long enough to need it. */
const SEARCH_FROM = 6;

const price = (value: number) => `$${(value * 1_000_000).toFixed(2)}/M`;

function AppearanceTab() {
  const { choice, setChoice } = useTheme();
  return (
    <div className="list">
      <div className="list-row">
        <span className="row-copy">
          <span className="row-title">Theme</span>
          <span className="row-sub wrap">System follows your device. Night dims every surface; the orb keeps its colours.</span>
        </span>
        <span className="row-end"><Segmented label="Theme" options={THEME_OPTIONS} value={choice} onChange={setChoice} /></span>
      </div>
    </div>
  );
}

type SettingsViewProps = {
  snapshot: RuntimeSnapshot;
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  apiKey: string;
  setApiKey: (value: string) => void;
  onConnect: (event: FormEvent<HTMLFormElement>) => void;
  onDisconnect: (providerId: ProviderId) => void;
  onStartCodexAuth: (mode: "browser" | "device") => void;
  onSubmitCodexAuth: (value: string) => void;
  onCancelCodexAuth: () => void;
  onRefresh: () => void;
  onSelectProvider: (providerId: ProviderId) => void;
  onSelectModel: (modelId: ProviderModel["id"]) => void;
  onSelectReasoning: (effort: RuntimeSnapshot["selectedReasoningEffort"]) => void;
};

export function SettingsView({ snapshot, section, onSection, apiKey, setApiKey, onConnect, onDisconnect, onStartCodexAuth, onSubmitCodexAuth, onCancelCodexAuth, onRefresh, onSelectProvider, onSelectModel, onSelectReasoning }: SettingsViewProps) {
  const [shown, setShown] = useState<SettingsSection>(section);
  const [leaving, setLeaving] = useState(false);
  const [viewId, setViewId] = useState<ProviderId>(snapshot.selectedProviderId);
  const [browseId, setBrowseId] = useState<ProviderId>(snapshot.selectedProviderId);
  const [modelSearch, setModelSearch] = useState("");
  const [modelSort, setModelSort] = useState<ModelSort>("recommended");

  // Two beats: the thumb moves at once, the old tab fades up, then the next one rises in.
  useEffect(() => {
    if (section === shown) { setLeaving(false); return; }
    setLeaving(true);
    const timer = setTimeout(() => { setShown(section); setLeaving(false); }, exitMs());
    return () => clearTimeout(timer);
  }, [section]);

  const selected = snapshot.models.find((model) => model.id === snapshot.selectedModelId);
  const browseProvider = snapshot.providers.find((provider) => provider.id === browseId) ?? snapshot.providers[0];
  const browseConnected = browseProvider?.verified ?? false;
  const catalog = browsableModels(snapshot.models, browseId);
  const query = modelSearch.trim().toLowerCase();
  const displayedModels = sortProviderModels(catalog.filter((model) => !query || `${model.name} ${model.baseModelId ?? model.rawId}`.toLowerCase().includes(query)), modelSort, snapshot.selectedModelId);
  const runActive = snapshot.activeRun !== null;
  const chooseModel = (model: ProviderModel) => {
    if (model.providerId !== "codex") return onSelectModel(model.id);
    const preferred = snapshot.models.find((candidate) => candidate.providerId === "codex" && candidate.baseModelId === model.baseModelId && candidate.reasoningEffort === snapshot.selectedReasoningEffort);
    onSelectModel((preferred ?? model).id);
  };
  const isChosen = (model: ProviderModel) => selected?.providerId === model.providerId && (model.providerId === "openrouter" ? selected.id === model.id : selected.baseModelId === model.baseModelId);
  // Roving tabindex: the radiogroup is one tab stop, the chosen model (or the first one when none is chosen in this list).
  const tabStopId = (displayedModels.find(isChosen) ?? displayedModels[0])?.id;
  const onRadioKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const keys: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    if (!(event.key in keys) && event.key !== "Home" && event.key !== "End") return;
    const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
    if (radios.length === 0) return;
    event.preventDefault();
    const at = radios.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? radios.length - 1 : (Math.max(at, 0) + keys[event.key]! + radios.length) % radios.length;
    radios[next]!.focus();
    radios[next]!.click();
  };
  const levels = orderedLevels(selected?.reasoningOptions);
  const level = nearestLevel(levels, snapshot.selectedReasoningEffort);
  const showEffort = browseConnected && selected?.providerId === browseId;

  const refreshButton = <button className="btn btn-ghost sm" type="button" onClick={onRefresh} disabled={snapshot.status === "loading-models"}>{snapshot.status === "loading-models" ? "Refreshing…" : "Refresh models"}</button>;
  const browse = (providerId: ProviderId) => { setBrowseId(providerId); onSection("models"); };

  const body = shown === "providers"
    ? <ProviderSettings snapshot={snapshot} apiKey={apiKey} setApiKey={setApiKey} onConnect={onConnect} onDisconnect={onDisconnect} onStartCodexAuth={onStartCodexAuth} onSubmitCodexAuth={onSubmitCodexAuth} onCancelCodexAuth={onCancelCodexAuth} onRefresh={onRefresh} onSelectProvider={onSelectProvider} viewId={viewId} onViewChange={setViewId} onBrowseModels={browse} />
    : shown === "models"
      ? <>
          <div className="list-group">
            <ProviderSelect snapshot={snapshot} value={browseId} onChange={(id) => { setBrowseId(id); setModelSearch(""); }} label="Providers" />
            {browseConnected && catalog.length > 0 && (
              <>
                {(catalog.length > SEARCH_FROM || query) && (
                  <div className="list">
                    <div className="list-row row-compose">
                      <input className="row-input" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search models" aria-label="Search models" />
                      <select className="row-select" value={modelSort} onChange={(event) => setModelSort(event.target.value as ModelSort)} aria-label="Sort models">
                        {MODEL_SORT_OPTIONS.map((sort) => <option value={sort} key={sort}>{modelSortLabel(sort)}</option>)}
                      </select>
                    </div>
                  </div>
                )}
                <div className="list" role="radiogroup" aria-label="Models" onKeyDown={onRadioKeyDown}>
                  {displayedModels.map((model) => {
                    const chosen = isChosen(model);
                    return (
                      <button type="button" role="radio" aria-checked={chosen} tabIndex={model.id === tabStopId ? 0 : -1} className="list-row model-row" key={model.id} disabled={runActive} onClick={() => chooseModel(model)}>
                        <span className="row-copy">
                          <span className="row-title">{model.providerId === "codex" ? model.baseModelId ?? model.name : model.name}</span>
                          <span className="row-sub">{model.description ? `${model.description} · ` : ""}<span className="mono">{model.providerId === "codex" ? model.baseModelId ?? model.rawId : model.rawId}</span></span>
                        </span>
                        <span className="row-end"><Check className="i sm row-check" aria-hidden="true" /></span>
                      </button>
                    );
                  })}
                  {displayedModels.length === 0 && <div className="list-row quiet">No models match.</div>}
                </div>
                <div className="models-foot">
                  {runActive || showEffort ? <p className="list-note">
                    {runActive ? "Models can change once the current run finishes. " : ""}
                    {showEffort && selected && `${selected.contextLength ? `${selected.contextLength.toLocaleString()} token context` : selected.providerId === "codex" ? "Context managed by Codex" : "Provider-managed context"}${selected.providerId === "openrouter" && selected.promptPrice !== undefined && selected.completionPrice !== undefined ? ` · Prompt ${price(selected.promptPrice)} · Completion ${price(selected.completionPrice)}` : ""}.`}
                  </p> : null}
                  {refreshButton}
                </div>
              </>
            )}
            {browseConnected && catalog.length === 0 && (
              <>
                <div className="list"><div className="list-row quiet">No models loaded yet. Use Refresh models to load them.</div></div>
                <div className="models-foot">{refreshButton}</div>
              </>
            )}
            {!browseConnected && browseProvider && (
              <div className="list">
                <button type="button" className="list-row quiet" onClick={() => { setViewId(browseProvider.id); onSection("providers"); }}>
                  <span className="row-copy"><span className="row-title">Connect {browseProvider.name} first</span><span className="row-sub">Its models appear here once it’s connected.</span></span>
                  <span className="row-end">Providers<ChevronRight className="i sm" aria-hidden="true" /></span>
                </button>
              </div>
            )}
          </div>
          {showEffort && selected && (
            <div className="list-group">
              <div className="list">
                <div className="list-row">
                  <span className="row-copy">
                    <span className="row-title">Reasoning effort</span>
                    <span className="row-sub wrap">{level ? `${effortHint(level)} Each chat can change it from the Island.${runActive ? " Locked until the current run finishes." : ""}` : NO_ADJUSTABLE_THINKING}</span>
                  </span>
                  {level && (
                    <div className={`settings-effort${runActive ? " is-locked" : ""}`}>
                      <EffortSlider model={selected.name} levels={levels} value={level} compact disabled={runActive} onChange={(next) => { if (!runActive) onSelectReasoning(next); }} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      : shown === "appearance"
        ? <AppearanceTab />
        : <DiagnosticsPanel />;

  return (
    <section className="settings-view">
      <div className="page settings-page">
        <div className="page-head window-drag-region electrobun-webkit-app-region-drag">
          <div>
            <h1 className="heading">Settings</h1>
            <p>How Proteus connects, which model thinks, and how it looks.</p>
          </div>
        </div>
        <Segmented id="settings-tab" label="Settings sections" options={TABS} value={section} onChange={onSection} />
        <div className={`list-stack settings-body${leaving ? " is-leaving" : ""}`} key={shown} role="tabpanel" aria-labelledby={segmentedTabId("settings-tab", shown)}>
          {body}
        </div>
      </div>
    </section>
  );
}
