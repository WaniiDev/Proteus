import { useState, type FormEvent, type ReactNode } from "react";
import { Brain, Check, HardDrive, Search, Settings2, ShieldCheck } from "lucide-react";
import type { MemoryScope, ProviderModel, RuntimeError, RuntimeSnapshot } from "../../shared/contracts";
import { MemorySettingsPanel } from "../components/MemorySettingsPanel";
import { MODEL_SORT_OPTIONS, modelSortLabel, sortProviderModels, type ModelSort } from "../lib/model-sorting";
import { PROVIDER_LOGOS } from "../lib/provider-assets";
import { ProviderSettings } from "../components/ProviderSettings";
import { Icon } from "../components/Icon";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { PageHeader } from "../components/PageHeader";

function errorForUi(error: RuntimeError | null): ReactNode {
  if (!error) return null;
  return (
    <div className={`runtime-alert ${error.code === "aborted" ? "muted" : "error"}`} role="status">
      <span>{error.message}</span>
    </div>
  );
}


export type SettingsSection = "providers" | "models" | "memory" | "developer";

export function SettingsView({ snapshot, section, onSection, memoryScope, apiKey, setApiKey, onConnect, onDisconnect, onStartCodexAuth, onSubmitCodexAuth, onCancelCodexAuth, onRefresh, onSelectProvider, onSelectModel, onSelectReasoning }: { snapshot: RuntimeSnapshot; section: SettingsSection; onSection: (section: SettingsSection) => void; memoryScope?: MemoryScope; apiKey: string; setApiKey: (value: string) => void; onConnect: (event: FormEvent<HTMLFormElement>) => void; onDisconnect: (providerId: "openrouter" | "codex") => void; onStartCodexAuth: (mode: "browser" | "device") => void; onSubmitCodexAuth: (value: string) => void; onCancelCodexAuth: () => void; onRefresh: () => void; onSelectProvider: (providerId: "openrouter" | "codex") => void; onSelectModel: (modelId: ProviderModel["id"]) => void; onSelectReasoning: (effort: RuntimeSnapshot["selectedReasoningEffort"]) => void }) {
  const [modelSearch, setModelSearch] = useState("");
  const [modelSort, setModelSort] = useState<ModelSort>("recommended");
  const selected = snapshot.models.find((model) => model.id === snapshot.selectedModelId);
  const price = (value: number | undefined) => (value === undefined ? "—" : `$${(value * 1_000_000).toFixed(2)}/M`);
  const providerModels = snapshot.models.filter((model) => model.providerId === snapshot.selectedProviderId);
  const displayedModels = sortProviderModels(providerModels.filter((model, index, all) => {
    if (model.providerId === "codex" && all.findIndex((candidate) => candidate.baseModelId === model.baseModelId) !== index) return false;
    const query = modelSearch.trim().toLowerCase();
    return !query || `${model.name} ${model.baseModelId ?? model.rawId}`.toLowerCase().includes(query);
  }), modelSort, snapshot.selectedModelId);
  const chooseDisplayedModel = (model: ProviderModel) => {
    if (model.providerId !== "codex") return onSelectModel(model.id);
    const preferred = snapshot.models.find((candidate) => candidate.providerId === "codex" && candidate.baseModelId === model.baseModelId && candidate.reasoningEffort === snapshot.selectedReasoningEffort);
    onSelectModel((preferred ?? model).id);
  };
  return (
    <section className="view active"><div className="page-narrow settings-page">
      <PageHeader kicker="Yours to control" title="Settings" subtitle="Choose how Proteus connects, which model thinks, and how deeply it reasons." />
      <div className="settings-layout">
      <nav className="settings-tabs" aria-label="Settings sections">
        <button type="button" className={section === "providers" ? "active" : ""} onClick={() => onSection("providers")}><ShieldCheck size={16} /><span><strong>Providers</strong><small>Connections and accounts</small></span></button>
        <button type="button" className={section === "models" ? "active" : ""} onClick={() => onSection("models")}><Settings2 size={16} /><span><strong>Models & thinking</strong><small>Intelligence and effort</small></span></button>
        <button type="button" className={section === "memory" ? "active" : ""} onClick={() => onSection("memory")}><Brain size={16} /><span><strong>Memory</strong><small>Saved context you control</small></span></button>
        <button type="button" className={section === "developer" ? "active" : ""} onClick={() => onSection("developer")}><HardDrive size={16} /><span><strong>Developer</strong><small>Diagnostics and exports</small></span></button>
      </nav>
      <div className="settings-content">
      {section === "providers" ? <><ProviderSettings snapshot={snapshot} apiKey={apiKey} setApiKey={setApiKey} onConnect={onConnect} onDisconnect={onDisconnect} onStartCodexAuth={onStartCodexAuth} onSubmitCodexAuth={onSubmitCodexAuth} onCancelCodexAuth={onCancelCodexAuth} onRefresh={onRefresh} onSelectProvider={onSelectProvider} />{errorForUi(snapshot.error)}</> : section === "models" ? <section className="card settings-card model-settings-card">
        <div className="settings-section-head"><div><h2 className="title-md">Model</h2><p className="settings-intro">Selection applies to the current conversation and becomes the default for new chats.</p></div><button className="btn-outline sm" type="button" onClick={onRefresh}><Icon name="refresh" size={15} /> Refresh</button></div>
        <div className="provider-switch" role="group" aria-label="Model provider">{snapshot.providers.map((provider) => <button type="button" key={provider.id} className={snapshot.selectedProviderId === provider.id ? "active" : ""} disabled={!provider.verified} onClick={() => onSelectProvider(provider.id)}><img src={PROVIDER_LOGOS[provider.id]} alt="" aria-hidden="true" /><span>{provider.name}</span></button>)}</div>
        <div className="model-catalog-tools">
          <div className="model-search"><Search size={16} /><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search models" aria-label="Search models" /></div>
          <select value={modelSort} onChange={(event) => setModelSort(event.target.value as ModelSort)} aria-label="Sort models">
            {MODEL_SORT_OPTIONS.map((sort) => <option value={sort} key={sort}>{modelSortLabel(sort)}</option>)}
          </select>
        </div>
        <div className="model-card-list">{displayedModels.map((model) => { const isSelected = selected?.providerId === model.providerId && (model.providerId === "openrouter" ? selected.id === model.id : selected.baseModelId === model.baseModelId); return <button type="button" className={`model-card ${isSelected ? "selected" : ""}`} key={model.id} onClick={() => chooseDisplayedModel(model)} disabled={snapshot.activeRun !== null}><span className="model-card-copy"><strong>{model.providerId === "codex" ? model.baseModelId : model.name}</strong><small>{model.description ?? model.rawId}</small></span>{isSelected && <Check size={17} />}</button>; })}</div>
        {selected?.reasoningOptions?.length ? <div className="reasoning-control"><div><span className="settings-eyebrow">Thinking</span><strong>Reasoning effort</strong></div><div className="reasoning-options">{selected.reasoningOptions.map((effort) => <button type="button" key={effort} className={snapshot.selectedReasoningEffort === effort ? "active" : ""} onClick={() => onSelectReasoning(effort)} disabled={snapshot.activeRun !== null}>{effort}</button>)}</div></div> : <p className="settings-note">This model does not advertise adjustable reasoning.</p>}
        {selected && <div className="model-meta"><span>{selected.contextLength ? `${selected.contextLength.toLocaleString()} token context` : selected.providerId === "codex" ? "Context managed by Codex" : "Provider-managed context"}</span>{selected.providerId === "openrouter" && <><span>Prompt {price(selected.promptPrice)}</span><span>Completion {price(selected.completionPrice)}</span></>}</div>}
      </section> : section === "memory" ? <MemorySettingsPanel focusScope={memoryScope} /> : <DiagnosticsPanel />}
      </div>
      </div>
    </div></section>
  );
}
