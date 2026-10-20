import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RuntimeSnapshot } from "../../shared/contracts";
import { ProviderSettings } from "./ProviderSettings";

function snapshot(): RuntimeSnapshot {
  return {
    revision: 1,
    status: "ready",
    credential: { configured: true, verified: true },
    providerAuth: null,
    providers: [
      { id: "openrouter", name: "OpenRouter", configured: true, verified: true, availability: "ready" },
      { id: "codex", name: "Codex", configured: true, verified: true, availability: "ready", detail: "Connected with ChatGPT OAuth." },
    ],
    models: [{ id: "codex/gpt-5", providerId: "codex", rawId: "gpt-5", name: "GPT-5", inputModalities: ["text"], outputModalities: ["text"] }],
    selectedProviderId: "codex",
    selectedModelId: "codex/gpt-5",
    selectedReasoningEffort: null,
    projects: [],
    activeWorkspace: { binding: { kind: "app" }, label: "Proteus workspace", availability: "ready" },
    threads: [], activeThreadId: null, retryMessageId: null, messages: [], events: [], interactions: [],
    workbench: { status: "idle", tasks: [], pendingInteractions: [], queuedFollowUpCount: 0, tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
    activeRun: null,
    continuation: null,
    error: null,
  };
}

function render(value: RuntimeSnapshot): string {
  return renderToStaticMarkup(<ProviderSettings
    snapshot={value}
    apiKey=""
    setApiKey={() => undefined}
    onConnect={() => undefined}
    onDisconnect={() => undefined}
    onConnectAnthropic={() => undefined}
    onStartCodexAuth={() => undefined}
    onSubmitCodexAuth={() => undefined}
    onCancelCodexAuth={() => undefined}
    onRefresh={() => undefined}
    onSelectProvider={() => undefined}
  />);
}

describe("provider settings redesign", () => {
  test("shows connected providers, secure storage, selection, and disconnect actions", () => {
    const html = render(snapshot());
    expect(html).toContain("AI providers");
    expect(html).toContain("2 of 2 connected");
    expect(html).toContain("Windows Credential Manager");
    expect(html).toContain("Use OpenRouter");
    expect(html).toContain("Current provider");
    expect(html).toContain("Disconnect key");
    expect(html).toContain("Disconnect ChatGPT");
    expect(html).not.toContain("provider-card");
  });

  test("keeps both ChatGPT connection paths when disconnected", () => {
    const value = snapshot();
    value.providers[1] = { id: "codex", name: "Codex", configured: false, verified: false, availability: "needs-configuration" };
    expect(render(value)).toContain("Connect in browser");
    expect(render(value)).toContain("Use device code");
  });

  test("offers an Anthropic API key form and shows why a stored key is unavailable", () => {
    const value = snapshot();
    value.providers.push({ id: "anthropic", name: "Anthropic", configured: false, verified: false, availability: "needs-configuration", detail: "Add an Anthropic API key to use Claude models." });
    let html = render(value);
    expect(html).toContain("2 of 3 connected");
    expect(html).toContain("Anthropic API key");
    expect(html).toContain("sk-ant-");
    expect(html).toContain("Add an Anthropic API key to use Claude models.");

    value.providers[2] = { id: "anthropic", name: "Anthropic", configured: true, verified: false, availability: "unavailable", detail: "That Anthropic API key is invalid or disabled." };
    html = render(value);
    expect(html).toContain("Enter a replacement key");
    expect(html).toContain("That Anthropic API key is invalid or disabled.");
    expect(html).toContain("Disconnect key");
  });

  test("keeps browser OAuth completion and cancellation controls", () => {
    const value = snapshot();
    value.providers[1] = { id: "codex", name: "Codex", configured: false, verified: false, availability: "checking" };
    value.providerAuth = { providerId: "codex", mode: "browser", status: "waiting", url: "https://example.com/auth", instructions: "Finish signing in.", code: "ABCD" };
    const html = render(value);
    expect(html).toContain("Waiting for you");
    expect(html).toContain("Open authorization page");
    expect(html).toContain("Paste callback URL or code");
    expect(html).toContain("Submit");
    expect(html).toContain("Cancel");
  });
});
