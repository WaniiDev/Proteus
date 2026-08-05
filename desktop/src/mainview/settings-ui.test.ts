import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appSource = readFileSync(join(import.meta.dir, "App.tsx"), "utf8");
const cssSource = readFileSync(join(import.meta.dir, "index.css"), "utf8");

describe("Settings provider and model UI", () => {
  it("uses tabbed provider/model sections and a custom model list", () => {
    expect(appSource).toContain('className="settings-tabs"');
    expect(appSource).toContain('>Developer</button>');
    expect(appSource).toContain('Runtime diagnostics');
    expect(appSource).toContain("Models & thinking");
    expect(appSource).toContain('className="provider-grid"');
    expect(appSource).toContain('className="model-card-list"');
    expect(appSource).toContain("Selection is remembered across conversations and app restarts.");
    expect(appSource).not.toContain('id="model-select"');
  });

  it("renders only advertised reasoning choices and keeps provider cards responsive", () => {
    expect(appSource).toContain("selected.reasoningOptions.map");
    expect(appSource).toContain('rpc.request["models.reasoning.select"]');
    expect(cssSource).toContain(".reasoning-options");
    expect(cssSource).toContain(".provider-grid, .model-card-list { grid-template-columns: 1fr; }");
  });

  it("offers upstream ChatGPT OAuth browser, device, manual, and cancel controls", () => {
    expect(appSource).toContain("Connect in browser");
    expect(appSource).toContain("Use device code");
    expect(appSource).toContain("Paste callback URL or code");
    expect(appSource).toContain('rpc.request["providers.auth.cancel"]');
    expect(appSource).not.toContain("Native ACP");
    expect(appSource).toContain('!provider.verified && snapshot.providerAuth?.providerId === "codex"');
  });
});
