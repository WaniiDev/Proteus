import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import type { ProviderId, ProviderStatus, RuntimeError, RuntimeSnapshot } from "../../shared/contracts";
import { BrandTile } from "./ProviderMark";
import { Select, type SelectOption, type SelectStatus } from "./ds/Select";

export type ProviderSettingsProps = {
  snapshot: RuntimeSnapshot;
  apiKey: string;
  setApiKey: (value: string) => void;
  onConnect: (event: FormEvent<HTMLFormElement>) => void;
  onDisconnect: (providerId: ProviderId) => void;
  onStartCodexAuth: (mode: "browser" | "device") => void;
  onSubmitCodexAuth: (value: string) => void;
  onCancelCodexAuth: () => void;
  onSelectProvider: (providerId: ProviderId) => void;
  /** Which provider the page shows. Controlled when both are given; otherwise it starts on the provider in use. */
  viewId?: ProviderId;
  onViewChange?: (providerId: ProviderId) => void;
  /** Opens Settings › Models on this provider. */
  onBrowseModels?: (providerId: ProviderId) => void;
  /** Kept so existing callers still compile; Refresh now lives on the Models tab. */
  onRefresh?: () => void;
};

/** How a provider connects, shown under its name. */
export const PROVIDER_HOW: Record<ProviderId, string> = {
  openrouter: "API key",
  codex: "ChatGPT account",
};

/** What the field says when Connect is pressed with nothing in it: the reason, in words. */
const EMPTY_KEY_MESSAGE: Partial<Record<ProviderId, string>> = {
  openrouter: "Paste your OpenRouter key to connect. It starts with sk-or-v1-.",
};
const KEY_PLACEHOLDER: Partial<Record<ProviderId, string>> = {
  openrouter: "Paste your key · sk-or-v1-…",
};

const CODEX_CODE_LINE = "Approve the sign-in in your browser. If it asks for a code, enter:";

const KEY_PROVIDERS: ReadonlySet<ProviderId> = new Set<ProviderId>(["openrouter"]);
/** Runtime errors that come from checking a key; they belong under the key field. */
const KEY_ERROR_CODES: ReadonlySet<RuntimeError["code"]> = new Set(["invalid-credential", "forbidden", "offline", "timeout", "rate-limited", "secure-store-unavailable"]);

export type ProviderViewState = "connected" | "checking" | "connecting" | "waiting" | "failed" | "unavailable" | "idle";
export type ProviderView = { state: ProviderViewState; label: string; dot: SelectStatus["dot"] };

/** The error from checking a key for this provider, or null. */
export function keyErrorFor(snapshot: RuntimeSnapshot, provider: ProviderStatus): RuntimeError | null {
  return KEY_PROVIDERS.has(provider.id) && snapshot.error && KEY_ERROR_CODES.has(snapshot.error.code) ? snapshot.error : null;
}

/** The one state a provider is in, from the snapshot alone. */
export function providerView(snapshot: RuntimeSnapshot, provider: ProviderStatus): ProviderView {
  const auth = snapshot.providerAuth?.providerId === provider.id && !provider.verified ? snapshot.providerAuth : null;
  if (auth?.status === "failed") return { state: "failed", label: "Not connected", dot: "err" };
  if (auth?.status === "waiting") return { state: "waiting", label: "Waiting for you", dot: "warn" };
  if (auth) return { state: "connecting", label: "Connecting…", dot: "run" };
  if (KEY_PROVIDERS.has(provider.id) && snapshot.status === "validating-key") return { state: "checking", label: "Checking…", dot: "run" };
  if (provider.availability === "checking") return { state: "checking", label: "Checking…", dot: "run" };
  if (provider.availability === "unavailable") return { state: "unavailable", label: "Unavailable", dot: "err" };
  if (provider.verified) return { state: "connected", label: "Connected", dot: "ok" };
  return { state: "idle", label: "Not connected", dot: keyErrorFor(snapshot, provider) ? "err" : undefined };
}

/** Models a person can pick for a provider: Codex variants that differ only by effort count once. */
export function browsableModels(models: RuntimeSnapshot["models"], providerId: ProviderId): RuntimeSnapshot["models"] {
  return models.filter((model, index, all) => model.providerId === providerId
    && (model.providerId !== "codex" || all.findIndex((candidate) => candidate.providerId === "codex" && candidate.baseModelId === model.baseModelId) === index));
}

function modelCount(snapshot: RuntimeSnapshot, providerId: ProviderId): string {
  const count = browsableModels(snapshot.models, providerId).length;
  return `${count} ${count === 1 ? "model" : "models"}`;
}

/** The Select that names a provider, with each option's own state. */
export function ProviderSelect({ snapshot, value, onChange, label }: { snapshot: RuntimeSnapshot; value: ProviderId; onChange: (providerId: ProviderId) => void; label: string }) {
  const options: SelectOption<ProviderId>[] = snapshot.providers.map((provider) => {
    const view = providerView(snapshot, provider);
    return {
      value: provider.id,
      name: provider.name,
      how: PROVIDER_HOW[provider.id],
      status: { text: view.label, dot: view.dot },
      mark: (small) => <BrandTile provider={provider.id} small={small} />,
    };
  });
  if (!options.length) return null;
  return <Select options={options} value={value} onChange={onChange} label={label} triggerLabel={(option) => `Provider: ${option.name}, ${option.status?.text.toLowerCase() ?? ""}. Choose a provider.`} />;
}

function subLine(snapshot: RuntimeSnapshot, provider: ProviderStatus, view: ProviderView, rejected: boolean): string {
  const how = PROVIDER_HOW[provider.id];
  const auth = snapshot.providerAuth?.providerId === provider.id ? snapshot.providerAuth : null;
  switch (view.state) {
    case "connected": return provider.detail ?? (KEY_PROVIDERS.has(provider.id) ? `${how} saved · ${modelCount(snapshot, provider.id)}` : "Signed in with ChatGPT");
    case "checking": return KEY_PROVIDERS.has(provider.id) ? "Checking the key with the provider…" : provider.detail ?? "Checking the connection…";
    case "connecting": return auth?.status === "completing" ? "Finishing the sign-in…" : "Opening your browser…";
    case "waiting": return "Waiting for you in the browser";
    case "failed": return auth?.error ?? "Authorization failed.";
    case "unavailable": return provider.detail ?? "This provider can’t be reached right now.";
    default:
      if (rejected) return "That key wasn’t accepted.";
      if (KEY_PROVIDERS.has(provider.id)) return provider.detail ?? `Add an ${provider.name} API key to use its models.`;
      return "Sign in with ChatGPT to load the Codex models.";
  }
}

export function ProviderSettings({ snapshot, apiKey, setApiKey, onConnect, onDisconnect, onStartCodexAuth, onSubmitCodexAuth, onCancelCodexAuth, onSelectProvider, viewId, onViewChange, onBrowseModels }: ProviderSettingsProps) {
  const [ownView, setOwnView] = useState<ProviderId>(snapshot.selectedProviderId);
  const [replacing, setReplacing] = useState(false);
  const [authorizationCode, setAuthorizationCode] = useState("");
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [emptyKey, setEmptyKey] = useState(false);
  const fieldId = useId();
  const wasChecking = useRef(false);

  const currentId = viewId ?? ownView;
  const provider = snapshot.providers.find((candidate) => candidate.id === currentId) ?? snapshot.providers[0];
  const connectedCount = snapshot.providers.filter((candidate) => candidate.verified).length;
  const view = provider ? providerView(snapshot, provider) : null;
  const keyError = provider ? keyErrorFor(snapshot, provider) : null;
  const errorKey = keyError ? `${keyError.code}:${keyError.message}` : null;
  const shownError = keyError && errorKey !== dismissedError ? keyError : null;
  const isKeyProvider = provider ? KEY_PROVIDERS.has(provider.id) : false;
  const checking = view?.state === "checking";

  // A replacement that checks out closes the field again; a failed one keeps it open with the old key still connected.
  useEffect(() => {
    if (wasChecking.current && !checking && provider?.verified && !keyError) setReplacing(false);
    wasChecking.current = checking;
  }, [checking, provider?.verified, keyError]);

  if (!provider || !view) return null;

  const choose = (next: ProviderId) => {
    setReplacing(false);
    setEmptyKey(false);
    setAuthorizationCode("");
    if (onViewChange) onViewChange(next);
    else setOwnView(next);
  };
  const isCurrent = snapshot.selectedProviderId === provider.id;
  const auth = snapshot.providerAuth?.providerId === provider.id && !provider.verified ? snapshot.providerAuth : null;
  const keyFieldOpen = isKeyProvider && (!provider.verified || replacing);
  const authOpen = !isKeyProvider && auth !== null;
  const locked = checking;
  const sub = subLine(snapshot, provider, view, shownError !== null && !provider.verified);
  const rowDot = view.state === "idle" && !shownError ? undefined : view.dot;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  const emptyMessage = emptyKey ? EMPTY_KEY_MESSAGE[provider.id] ?? "Paste your key to connect." : null;
  const fieldError = emptyMessage ?? shownError?.message ?? null;
  // A rejected key is still stored: Disconnect only means something for a connected provider, so this one is named for what it does.
  const removable = provider.configured && !provider.verified && !locked && view.state !== "connecting" && view.state !== "waiting";

  const submitKey = (event: FormEvent<HTMLFormElement>) => {
    setDismissedError(null);
    if (!apiKey.trim()) {
      event.preventDefault();
      setEmptyKey(true);
      return;
    }
    onConnect(event);
  };

  return (
    <div className="list-group">
      <span className="list-label kicker">Provider · {connectedCount} of {snapshot.providers.length} connected</span>
      <ProviderSelect snapshot={snapshot} value={provider.id} onChange={choose} label="Providers" />

      <div className="list provider-list">
        <div className="list-row">
          <span className={rowDot ? `dot ${rowDot}` : "dot"} />
          <span className="row-copy">
            <span className="row-title">{view.label}</span>
            <span className="row-sub" role={view.state === "failed" ? "alert" : undefined}>{sub}</span>
          </span>
          <span className="row-end">
            {provider.verified && (isCurrent
              ? <span className="badge">In use</span>
              : <button className="btn btn-secondary sm" type="button" disabled={snapshot.activeRun !== null} onClick={() => onSelectProvider(provider.id)}>Use</button>)}
            {isKeyProvider && provider.verified && !replacing && <button className="btn btn-ghost sm" type="button" disabled={locked} onClick={() => { setDismissedError(null); setEmptyKey(false); setReplacing(true); }}>Replace key</button>}
            {!isKeyProvider && !provider.configured && !auth && view.state !== "checking" && (
              <>
                <button className="btn btn-secondary sm" type="button" onClick={() => onStartCodexAuth("browser")}>Sign in</button>
                <button className="btn btn-ghost sm" type="button" onClick={() => onStartCodexAuth("device")}>Use a device code</button>
              </>
            )}
            {(provider.verified || removable) && <button className="btn btn-danger-ghost sm" type="button" disabled={locked} onClick={() => onDisconnect(provider.id)}>{provider.verified || !isKeyProvider ? "Disconnect" : "Remove saved key"}</button>}
          </span>
        </div>

        {isKeyProvider && (
          <div className={`list-expand${keyFieldOpen ? " is-open" : ""}`}>
            <div>
              <div className="list-expand-body">
                <form className="provider-key-form" onSubmit={submitKey}>
                  <input
                    className="input"
                    type="password"
                    value={apiKey}
                    onChange={(event) => { setApiKey(event.target.value); setEmptyKey(false); if (errorKey) setDismissedError(errorKey); }}
                    placeholder={replacing ? "Enter a replacement key" : KEY_PLACEHOLDER[provider.id] ?? "Paste your key"}
                    autoComplete="off"
                    aria-label={`${provider.name} API key`}
                    aria-invalid={fieldError ? true : undefined}
                    aria-describedby={fieldError ? errorId : replacing ? undefined : hintId}
                    disabled={locked}
                    tabIndex={keyFieldOpen ? undefined : -1}
                  />
                  <button className="btn btn-primary" type="submit" disabled={locked} tabIndex={keyFieldOpen ? undefined : -1}>
                    {checking && <span className="spinner" aria-hidden="true" />}
                    {checking ? "Checking…" : replacing ? "Replace" : "Connect"}
                  </button>
                  {replacing && <button className="btn btn-ghost" type="button" disabled={locked} onClick={() => { setReplacing(false); setEmptyKey(false); setApiKey(""); }}>Cancel</button>}
                </form>
                {fieldError
                  ? <span className="field-error" id={errorId} role="alert">{fieldError}</span>
                  : !replacing && <span className="field-hint" id={hintId}>Proteus checks the key by loading your {provider.name} models. Only a key that works is saved.</span>}
              </div>
            </div>
          </div>
        )}

        {!isKeyProvider && (
          <div className={`list-expand${authOpen ? " is-open" : ""}`}>
            <div>
              <div className="list-expand-body">
                {auth && (
                  <>
                    {auth.status !== "failed" && <p className="provider-auth-line">{auth.code && auth.status === "waiting" ? CODEX_CODE_LINE : auth.instructions ?? "Finish signing in with your ChatGPT account."}</p>}
                    {auth.code && auth.status !== "failed" && (
                      <div className="provider-auth-code">
                        <code>{auth.code}</code>
                        <button className="btn btn-ghost sm" type="button" onClick={onCancelCodexAuth}>Cancel</button>
                      </div>
                    )}
                    {auth.url && auth.status !== "failed" && <a className="provider-auth-link" href={auth.url} target="_blank" rel="noreferrer">Open authorization page <ExternalLink className="i sm" aria-hidden="true" /></a>}
                    {auth.mode === "browser" && auth.status === "waiting" && (
                      <form className="provider-key-form" onSubmit={(event) => { event.preventDefault(); onSubmitCodexAuth(authorizationCode); setAuthorizationCode(""); }}>
                        <input className="input" value={authorizationCode} onChange={(event) => setAuthorizationCode(event.target.value)} placeholder="Paste callback URL or code" aria-label="ChatGPT authorization code" autoComplete="off" />
                        <button className="btn btn-primary" type="submit" disabled={!authorizationCode.trim()}>Submit</button>
                      </form>
                    )}
                    {(auth.status === "failed" || !auth.code) && (
                      <div className="provider-auth-actions">
                        {auth.status === "failed"
                          ? <>
                              <button className="btn btn-secondary sm" type="button" onClick={() => onStartCodexAuth("browser")}>Try browser again</button>
                              <button className="btn btn-ghost sm" type="button" onClick={() => onStartCodexAuth("device")}>Try a device code</button>
                            </>
                          : <button className="btn btn-ghost sm" type="button" onClick={onCancelCodexAuth}>Cancel</button>}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {provider.verified && (onBrowseModels
          ? (
            <button className="list-row" type="button" onClick={() => onBrowseModels(provider.id)}>
              <span className="row-copy"><span className="row-title">Models</span><span className="row-sub">{modelCount(snapshot, provider.id)}{isCurrent ? " · in use" : ""}</span></span>
              <span className="row-end">Browse<ChevronRight className="i sm" aria-hidden="true" /></span>
            </button>
          )
          : (
            <div className="list-row">
              <span className="row-copy"><span className="row-title">Models</span><span className="row-sub">{modelCount(snapshot, provider.id)}{isCurrent ? " · in use" : ""}</span></span>
            </div>
          ))}
      </div>
      <p className="list-note">Credentials stay in Windows Credential Manager. They never appear in conversations or diagnostics.</p>
    </div>
  );
}
