import { useState, type FormEvent } from "react";
import { CheckCircle2, ExternalLink, KeyRound, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import type { ProviderId, ProviderStatus, RuntimeSnapshot } from "../shared/contracts";
import { PROVIDER_LOGOS } from "./provider-assets";

type ProviderSettingsProps = {
  snapshot: RuntimeSnapshot;
  apiKey: string;
  setApiKey: (value: string) => void;
  onConnect: (event: FormEvent<HTMLFormElement>) => void;
  onDisconnect: (providerId: ProviderId) => void;
  onStartCodexAuth: (mode: "browser" | "device") => void;
  onSubmitCodexAuth: (value: string) => void;
  onCancelCodexAuth: () => void;
  onRefresh: () => void;
  onSelectProvider: (providerId: ProviderId) => void;
};

const PROVIDER_COPY: Record<ProviderId, { eyebrow: string; description: string; credential: string }> = {
  openrouter: {
    eyebrow: "Model gateway",
    description: "Use one API key to reach your OpenRouter text-model catalog.",
    credential: "API key",
  },
  codex: {
    eyebrow: "ChatGPT subscription",
    description: "Connect a ChatGPT Plus or Pro account through secure OAuth.",
    credential: "OAuth",
  },
};

function connectionLabel(provider: ProviderStatus): string {
  if (provider.availability === "checking") return "Checking";
  if (provider.availability === "unavailable") return "Unavailable";
  if (provider.verified) return "Connected";
  return "Not connected";
}

export function ProviderSettings({ snapshot, apiKey, setApiKey, onConnect, onDisconnect, onStartCodexAuth, onSubmitCodexAuth, onCancelCodexAuth, onRefresh, onSelectProvider }: ProviderSettingsProps) {
  const [authorizationCode, setAuthorizationCode] = useState("");
  const connectedCount = snapshot.providers.filter((provider) => provider.verified).length;

  return (
    <section className="provider-settings" aria-labelledby="provider-settings-title">
      <header className="provider-settings__header">
        <div>
          <span className="settings-eyebrow">Connections</span>
          <h2 className="title-md" id="provider-settings-title">AI providers</h2>
          <p>Manage credentials and choose which connected provider powers this conversation.</p>
        </div>
        <button className="btn-outline sm" type="button" onClick={onRefresh} disabled={snapshot.status === "loading-models"}>
          <RefreshCw size={15} />
          {snapshot.status === "loading-models" ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <div className="provider-settings__trust">
        <ShieldCheck size={18} />
        <div><strong>{connectedCount} of {snapshot.providers.length} connected</strong><span>Credentials stay in Windows Credential Manager.</span></div>
      </div>

      <div className="provider-settings__list">
        {snapshot.providers.map((provider) => {
          const copy = PROVIDER_COPY[provider.id];
          const isCurrent = snapshot.selectedProviderId === provider.id;
          const isChecking = provider.availability === "checking";
          return (
            <article className={`provider-connection ${isCurrent ? "current" : ""}`} key={provider.id}>
              <header className="provider-connection__header">
                <div className="provider-connection__identity">
                  <span className="provider-connection__logo"><img src={PROVIDER_LOGOS[provider.id]} alt="" aria-hidden="true" /></span>
                  <div><span>{copy.eyebrow}</span><h3>{provider.name}</h3></div>
                </div>
                <div className="provider-connection__badges">
                  {isCurrent && <span className="provider-current-badge">In use</span>}
                  <span className={`provider-state ${provider.availability}`}>
                    {isChecking ? <LoaderCircle size={13} aria-hidden="true" /> : provider.verified ? <CheckCircle2 size={13} aria-hidden="true" /> : null}
                    {connectionLabel(provider)}
                  </span>
                </div>
              </header>

              <div className="provider-connection__body">
                <div className="provider-connection__about">
                  <p>{copy.description}</p>
                  <dl><div><dt>Credential</dt><dd>{copy.credential}</dd></div><div><dt>Storage</dt><dd>Windows secure store</dd></div></dl>
                </div>

                <div className="provider-connection__controls">
                  {provider.id === "openrouter" ? (
                    <form className="provider-key-form" onSubmit={onConnect}>
                      <KeyRound size={17} aria-hidden="true" />
                      <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={snapshot.credential.configured ? "Enter a replacement key" : "sk-or-v1-…"} autoComplete="off" aria-label="OpenRouter API key" />
                      <button className="btn-primary sm" type="submit" disabled={!apiKey.trim() || snapshot.status === "validating-key"}>{snapshot.status === "validating-key" ? "Checking…" : snapshot.credential.configured ? "Replace" : "Connect"}</button>
                    </form>
                  ) : (
                    <div className="provider-oauth-controls">
                      <p>{provider.detail ?? (provider.verified ? "Connected with ChatGPT OAuth." : "Connect ChatGPT to load the Codex model catalog.")}</p>
                      {!provider.configured && !snapshot.providerAuth && <div className="provider-action-group"><button className="btn-primary sm" type="button" onClick={() => onStartCodexAuth("browser")}>Connect in browser</button><button className="btn-outline sm" type="button" onClick={() => onStartCodexAuth("device")}>Use device code</button></div>}
                      {!provider.verified && snapshot.providerAuth?.providerId === "codex" && (
                        <div className={`provider-oauth-progress ${snapshot.providerAuth.status}`} role="status">
                          <strong>{snapshot.providerAuth.status === "failed" ? "Authorization failed" : snapshot.providerAuth.status === "waiting" ? "Waiting for you" : "Connecting…"}</strong>
                          <p>{snapshot.providerAuth.error ?? snapshot.providerAuth.instructions}</p>
                          {snapshot.providerAuth.code && <code>{snapshot.providerAuth.code}</code>}
                          {snapshot.providerAuth.url && <a href={snapshot.providerAuth.url} target="_blank" rel="noreferrer">Open authorization page <ExternalLink size={13} /></a>}
                          {snapshot.providerAuth.mode === "browser" && snapshot.providerAuth.status === "waiting" && <form className="provider-code-form" onSubmit={(event) => { event.preventDefault(); onSubmitCodexAuth(authorizationCode); setAuthorizationCode(""); }}><input value={authorizationCode} onChange={(event) => setAuthorizationCode(event.target.value)} placeholder="Paste callback URL or code" aria-label="ChatGPT authorization code" /><button className="btn-primary sm" type="submit" disabled={!authorizationCode.trim()}>Submit</button></form>}
                          {snapshot.providerAuth.status !== "failed" ? <button className="btn-danger-ghost" type="button" onClick={onCancelCodexAuth}>Cancel</button> : <div className="provider-action-group"><button className="btn-primary sm" type="button" onClick={() => onStartCodexAuth("browser")}>Try browser again</button><button className="btn-outline sm" type="button" onClick={() => onStartCodexAuth("device")}>Try device code</button></div>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <footer className="provider-connection__footer">
                <button className={isCurrent ? "provider-current-action" : "btn-outline sm"} type="button" disabled={!provider.verified || snapshot.activeRun !== null || isCurrent} onClick={() => onSelectProvider(provider.id)}>{isCurrent ? "Current provider" : `Use ${provider.name}`}</button>
                {provider.configured && <button className="btn-danger-ghost" type="button" onClick={() => onDisconnect(provider.id)}>{provider.id === "codex" ? "Disconnect ChatGPT" : "Disconnect key"}</button>}
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}
