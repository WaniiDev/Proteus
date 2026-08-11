import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appSource = readFileSync(join(import.meta.dir, "App.tsx"), "utf8");
const providerSource = readFileSync(join(import.meta.dir, "ProviderSettings.tsx"), "utf8");
const cssSource = readFileSync(join(import.meta.dir, "index.css"), "utf8");

describe("Settings provider and model UI", () => {
  it("uses tabbed provider/model sections and a custom model list", () => {
    expect(appSource).toContain('className="settings-tabs"');
    expect(appSource).toContain("Diagnostics and exports");
    expect(appSource).toContain('className="settings-layout"');
    expect(appSource).toContain('Runtime diagnostics');
    expect(appSource).toContain("Models & thinking");
    expect(appSource).toContain("<ProviderSettings");
    expect(appSource).toContain('className="model-card-list"');
    expect(appSource).toContain('src={PROVIDER_LOGOS[provider.id]}');
    expect(cssSource).toContain(".provider-switch img { width: 20px; height: 20px");
    expect(providerSource).toContain('className="provider-settings__list"');
    expect(providerSource).toContain('className={`provider-connection ${isCurrent ? "current" : ""}`}');
    expect(providerSource).toContain("Credentials stay in Windows Credential Manager");
    expect(cssSource).toContain(".provider-connection { position: relative;");
    expect(cssSource).toContain(".provider-code-form { grid-template-columns: minmax(0,1fr) auto; }");
    expect(cssSource).toContain(".provider-state.checking svg { animation: none !important; }");
    expect(cssSource).not.toContain(".provider-card {");
    expect(appSource).toContain("Selection applies to the current conversation and becomes the default for new chats.");
    expect(appSource).not.toContain('id="model-select"');
  });

  it("renders only advertised reasoning choices and keeps provider connections responsive", () => {
    expect(appSource).toContain("selected.reasoningOptions.map");
    expect(appSource).toContain('rpc.request["models.reasoning.select"]');
    expect(cssSource).toContain(".reasoning-options");
    expect(cssSource).toContain(".model-card-list { grid-template-columns: 1fr; }");
    expect(cssSource).toContain("grid-template-columns: 210px minmax(0, 1fr)");
  });

  it("offers upstream ChatGPT OAuth browser, device, manual, and cancel controls", () => {
    expect(providerSource).toContain("Connect in browser");
    expect(providerSource).toContain("Use device code");
    expect(providerSource).toContain("Paste callback URL or code");
    expect(appSource).toContain('rpc.request["providers.auth.cancel"]');
    expect(providerSource).not.toContain("Native ACP");
    expect(providerSource).toContain('!provider.verified && snapshot.providerAuth?.providerId === "codex"');
  });
});
