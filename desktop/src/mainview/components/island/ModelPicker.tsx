import { ChevronRight } from "lucide-react";
import type { ProviderModel, ProviderModelId, ProviderStatus, ReasoningEffort } from "../../../shared/contracts";
import { effortHint } from "../../lib/effort";
import { EffortSlider } from "../EffortSlider";
import { ProviderMark } from "../ProviderMark";
import { Segmented } from "../ds/Segmented";
import { PickerShell, type PickerShellProps } from "./PickerShell";

type Shared = Pick<PickerShellProps, "open" | "chipsRef" | "onDismiss">;

export type EffortControl = {
  modelName: string;
  levels: readonly ReasoningEffort[];
  value: ReasoningEffort | null;
  onChange: (level: ReasoningEffort) => void;
  onTopLevel?: () => void;
};

export type ModelPickerProps = Shared & {
  providers: readonly ProviderStatus[];
  /** The provider whose models are listed (a tab can browse one that isn't selected). */
  browseProviderId: string;
  onBrowse: (providerId: string) => void;
  models: readonly ProviderModel[];
  selectedModelId: ProviderModelId;
  busy: boolean;
  running: boolean;
  error: string | null;
  onPick: (modelId: ProviderModelId) => void;
  /** Present only when the browsed provider holds the selected model and that model offers thinking. */
  effort: EffortControl | null;
  onConnect: () => void;
  onManage: () => void;
};

const CHECK = (
  <svg className="i sm row-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
);

function contextNote(model: ProviderModel): string {
  if (!model.contextLength) return model.baseModelId ?? model.rawId;
  const k = model.contextLength >= 1_000_000 ? `${+(model.contextLength / 1_000_000).toFixed(1)}M` : `${Math.round(model.contextLength / 1000)}K`;
  return `${k} context`;
}

/** The full picker: provider tabs, the models as a radio group, the Thinking slider and a link to Settings. */
export function ModelPicker({ open, chipsRef, onDismiss, providers, browseProviderId, onBrowse, models, selectedModelId, busy, running, error, onPick, effort, onConnect, onManage }: ModelPickerProps) {
  const browsed = providers.find((provider) => provider.id === browseProviderId);
  const connected = !!browsed?.verified && browsed.availability === "ready";
  return (
    <PickerShell open={open} label="Model and thinking" from="from-end" chipsRef={chipsRef} onDismiss={onDismiss}>
      <div className="picker-head">
        <span className="kicker">Model · {browsed?.name ?? "Provider"}</span>
        {providers.length > 1 && (
          <Segmented
            className="sm icons"
            label="Provider"
            value={browseProviderId}
            onChange={onBrowse}
            options={providers.map((provider) => ({ value: provider.id, label: provider.name, icon: <ProviderMark provider={provider.id} /> }))}
          />
        )}
      </div>
      {connected ? (
        <>
          <div role="radiogroup" aria-label="Model" className="picker-group">
            {models.map((model) => (
              <button type="button" className="picker-option" role="radio" key={model.id} aria-checked={model.id === selectedModelId} disabled={busy} onClick={() => onPick(model.id)}>
                <span><strong>{model.name}</strong><small>{contextNote(model)}</small></span>
                {CHECK}
              </button>
            ))}
            {models.length === 0 && <p className="picker-hint">No models yet. Refresh the list in Settings.</p>}
          </div>
          {effort && (
            <div className="picker-section">
              <span className="kicker">Thinking</span>
              <EffortSlider model={effort.modelName} levels={effort.levels} value={effort.value} onChange={effort.onChange} onTopLevel={effort.onTopLevel} />
            </div>
          )}
        </>
      ) : (
        <button type="button" className="picker-option" onClick={onConnect}>
          <span className="dot warn" />
          <span><strong>Connect {browsed?.name ?? "this provider"}</strong><small>Its models appear here once it’s connected.</small></span>
          <ChevronRight className="i sm" aria-hidden="true" />
        </button>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="picker-foot">
        <span>{running ? "Applies from your next message." : "Used for your next message."}</span>
        <button type="button" className="btn btn-ghost sm" onClick={onManage}>Manage models in Settings<ChevronRight className="i sm" aria-hidden="true" /></button>
      </div>
    </PickerShell>
  );
}

export type EffortPickerProps = Shared & { effort: EffortControl };

/** The compact picker: only the Thinking slider, headed by the model's name. */
export function EffortPicker({ open, chipsRef, onDismiss, effort }: EffortPickerProps) {
  return (
    <PickerShell open={open} label="Thinking" from="from-end" compact chipsRef={chipsRef} onDismiss={onDismiss}>
      <div className="picker-head picker-head-tight">
        <span className="kicker">Thinking</span>
        <span className="field-hint">{effort.modelName}</span>
      </div>
      <div className="picker-slider">
        <EffortSlider model={effort.modelName} levels={effort.levels} value={effort.value} onChange={effort.onChange} onTopLevel={effort.onTopLevel} compact />
      </div>
      <p className="picker-hint picker-hint-below">{effort.value ? effortHint(effort.value) : ""}</p>
    </PickerShell>
  );
}
