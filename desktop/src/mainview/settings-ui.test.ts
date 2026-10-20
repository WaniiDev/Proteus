import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(import.meta.dir, path), "utf8");
const view = read("views/SettingsView.tsx");
const diagnostics = read("components/DiagnosticsPanel.tsx");
const providers = read("components/ProviderSettings.tsx");
const shell = read("App.tsx");
const css = read("index.css") + read("proteus.css") + read("sidebar.css");

describe("Settings page", () => {
  it("is a Page with a 24px head and a Segmented for its five tabs", () => {
    expect(view).toContain('className="page settings-page"');
    expect(view).toContain('className="heading">Settings</h1>');
    expect(view).not.toContain("PageHeader");
    expect(view).toContain("<Segmented");
    for (const label of ["Providers", "Models", "Memory", "Appearance", "Developer"]) expect(view).toContain(`label: "${label}"`);
    expect(view).toContain('role="tabpanel"');
    expect(view).toContain("<ProviderSettings");
    expect(view).toContain("<DiagnosticsPanel />");
  });

  it("lists models as a radio group with a check, and thinking as the EffortSlider", () => {
    expect(view).toContain('role="radiogroup"');
    expect(view).toContain('role="radio"');
    expect(view).toContain("row-check");
    expect(view).toContain("<EffortSlider");
    expect(view).toContain("NO_ADJUSTABLE_THINKING");
    expect(view).toContain("<ProviderSelect");
    expect(shell).toContain('rpc.request["models.reasoning.select"]');
    expect(shell).toContain('rpc.request["models.refresh"]');
  });

  it("wires Appearance to the theme hook", () => {
    expect(view).toContain("useTheme()");
    expect(view).toContain('label: "Night"');
  });

  it("explains in the heading or a list note, never a banner", () => {
    for (const source of [view, providers, diagnostics]) {
      expect(source).not.toContain("runtime-alert");
      expect(source).not.toContain('className="notice');
      expect(source).not.toContain("card settings-card");
    }
    expect(providers).toContain("list-note");
  });

  it("offers ChatGPT sign-in, device code, manual code and cancel, and the Credential Manager note", () => {
    expect(providers).toContain("Sign in");
    expect(providers).toContain("Use a device code");
    expect(providers).toContain("Paste callback URL or code");
    expect(providers).toContain("Credentials stay in Windows Credential Manager");
    expect(shell).toContain('rpc.request["providers.auth.cancel"]');
    expect(providers).not.toContain("Native ACP");
  });

  it("puts Developer in List rows: a Switch, event rows and one danger row", () => {
    expect(diagnostics).toContain("list-row switch");
    expect(diagnostics).toContain("list-row event");
    expect(diagnostics.match(/list-row danger/g)?.length).toBe(1);
  });

  it("ships none of the old settings, provider, model-card or diagnostics CSS", () => {
    for (const legacy of ["settings-tabs", "settings-layout", "settings-card", "provider-connection", "provider-settings", "provider-switch", "model-card", "reasoning-options", "diagnostics-card", "diagnostic-source", "runtime-alert"]) {
      expect(css).not.toContain(`.${legacy}`);
    }
  });
});
