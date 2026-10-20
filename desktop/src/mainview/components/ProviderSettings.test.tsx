import { describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProviderId, RuntimeSnapshot } from "../../shared/contracts";
import { useDom } from "../test/dom";
import { ProviderSettings, keyErrorFor, providerView } from "./ProviderSettings";

useDom();

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
    models: [
      { id: "codex/gpt-5", providerId: "codex", rawId: "gpt-5", name: "GPT-5", inputModalities: ["text"], outputModalities: ["text"] },
      { id: "openrouter/a", providerId: "openrouter", rawId: "a", name: "A", inputModalities: ["text"], outputModalities: ["text"] },
      { id: "openrouter/b", providerId: "openrouter", rawId: "b", name: "B", inputModalities: ["text"], outputModalities: ["text"] },
    ],
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

const noop = () => undefined;
function render(value: RuntimeSnapshot, viewId: ProviderId, apiKey = ""): string {
  return renderToStaticMarkup(<ProviderSettings
    snapshot={value}
    viewId={viewId}
    onViewChange={noop}
    onBrowseModels={noop}
    apiKey={apiKey}
    setApiKey={noop}
    onConnect={noop}
    onDisconnect={noop}
    onStartCodexAuth={noop}
    onSubmitCodexAuth={noop}
    onCancelCodexAuth={noop}
    onSelectProvider={noop}
  />);
}

const disconnected = (value: RuntimeSnapshot, id: ProviderId) => {
  value.providers = value.providers.map((p) => p.id === id ? { ...p, configured: false, verified: false, availability: "needs-configuration" as const, detail: undefined } : p);
  if (id === "openrouter") value.credential = { configured: false, verified: false };
  return value;
};

describe("provider settings", () => {
  test("labels the select with how many providers are connected and shows one provider's list", () => {
    const html = render(snapshot(), "openrouter");
    expect(html).toContain("Provider · 2 of 2 connected");
    expect(html).toContain('class="select-trigger"');
    expect(html).toContain("Credentials stay in Windows Credential Manager");
    expect(html).not.toContain("provider-connection");
    expect(html).not.toContain("runtime-alert");
  });

  test("connected: state title, detail, Use, Replace key, Disconnect and a Models row", () => {
    const html = render(snapshot(), "openrouter");
    expect(html).toContain("Connected");
    expect(html).toContain("API key saved · 2 models");
    expect(html).toContain(">Use</button>");
    expect(html).toContain("Replace key");
    expect(html).toContain("Disconnect");
    expect(html).toContain("Browse");
    expect(html).not.toContain("list-expand is-open");
  });

  test("the provider in use shows the In use badge instead of Use, with the runtime's own detail", () => {
    const html = render(snapshot(), "codex");
    expect(html).toContain('<span class="badge">In use</span>');
    expect(html).not.toContain(">Use</button>");
    expect(html).toContain("Connected with ChatGPT OAuth.");
    expect(html).toContain("1 model · in use");
  });

  test("not connected: the key field is open under the row with one line saying how the key is checked", () => {
    const html = render(disconnected(snapshot(), "openrouter"), "openrouter");
    expect(html).toContain("Not connected");
    expect(html).toContain("list-expand is-open");
    expect(html).toContain('type="password"');
    expect(html).toContain(">Connect</button>");
    expect(html).toContain("Proteus checks the key by loading your OpenRouter models. Only a key that works is saved.");
    expect(html).not.toContain("Browse");
    expect(html).not.toContain("field-error");
  });

  test("checking: Checking… with a spinner, the field and button locked", () => {
    const value = disconnected(snapshot(), "openrouter");
    value.status = "validating-key";
    const html = render(value, "openrouter", "sk-or-v1-candidate");
    expect(html).toContain("<span class=\"row-title\">Checking…</span>");
    expect(html).toContain('class="spinner"');
    expect(html).toContain("dot run");
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("rejected: the field stays open with the runtime message as an alert and an invalid input", () => {
    const value = disconnected(snapshot(), "openrouter");
    value.credential = { configured: true, verified: false };
    value.status = "needs-key";
    value.error = { code: "invalid-credential", message: "OpenRouter rejected that key.", retryable: false };
    const html = render(value, "openrouter");
    expect(html).toContain("list-expand is-open");
    expect(html).toContain('<span class="field-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("OpenRouter rejected that key.");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("dot err");
    expect(html).toContain("That key wasn’t accepted.");
  });

  test("never renders a credential value beyond the controlled password input", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const secret = "sk-or-v1-SECRETSECRET1234567890";
    const value = disconnected(snapshot(), "openrouter");
    const host = document.createElement("div");
    document.body.append(host);
    function Harness() {
      const [apiKey, setApiKey] = useState("");
      return <ProviderSettings snapshot={value} viewId="openrouter" onViewChange={noop} onBrowseModels={noop} apiKey={apiKey} setApiKey={setApiKey}
        onConnect={noop} onDisconnect={noop} onStartCodexAuth={noop} onSubmitCodexAuth={noop} onCancelCodexAuth={noop} onSelectProvider={noop} />;
    }
    const root = createRoot(host);
    await act(async () => root.render(<Harness />));
    const input = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(input, secret); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(input.value).toBe(secret);

    // Everywhere except that one input's value, the secret is absent from text and from every attribute.
    expect(host.textContent).not.toContain(secret);
    for (const element of Array.from(host.querySelectorAll("*"))) {
      for (const attribute of Array.from(element.attributes)) {
        if (element === input && attribute.name === "value") continue;
        expect(attribute.value).not.toContain(secret);
      }
    }
    expect(Array.from(host.querySelectorAll("input")).filter((el) => el.value.includes(secret))).toEqual([input]);

    // The snapshot-derived rows never carry it either.
    const rows = value.providers.map((provider) => ({ view: providerView(value, provider), error: keyErrorFor(value, provider) }));
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(JSON.stringify(value)).not.toContain(secret);
    await act(async () => root.unmount());
    host.remove();
  });

  test("codex not connected offers Sign in and a device code, with the expand closed", () => {
    const html = render(disconnected(snapshot(), "codex"), "codex");
    expect(html).toContain("Sign in</button>");
    expect(html).toContain("Use a device code");
    expect(html).not.toContain("list-expand is-open");
    expect(html).not.toContain('type="password"');
  });

  test("codex device code: Waiting for you, the code under the row, and Cancel", () => {
    const value = disconnected(snapshot(), "codex");
    value.providerAuth = { providerId: "codex", mode: "device", status: "waiting", url: "https://example.com/device", instructions: "Enter this code on the page.", code: "QX7K-4MPD" };
    const html = render(value, "codex");
    expect(html).toContain("Waiting for you");
    expect(html).toContain("list-expand is-open");
    expect(html).toContain("QX7K-4MPD");
    expect(html).toContain("Open authorization page");
    expect(html).toContain("Cancel");
    expect(html).not.toContain("Paste callback URL or code");
  });

  test("codex browser sign-in waits with a paste field; starting shows Connecting…", () => {
    const value = disconnected(snapshot(), "codex");
    value.providerAuth = { providerId: "codex", mode: "browser", status: "waiting", url: "https://example.com/auth", instructions: "Finish signing in." };
    expect(render(value, "codex")).toContain("Paste callback URL or code");
    value.providerAuth = { providerId: "codex", mode: "browser", status: "starting" };
    const html = render(value, "codex");
    expect(html).toContain("Connecting…");
    expect(html).not.toContain("Paste callback URL or code");
  });

  test("codex authorization failed: an alert with the error and both retry paths", () => {
    const value = disconnected(snapshot(), "codex");
    value.providerAuth = { providerId: "codex", mode: "browser", status: "failed", error: "The sign-in timed out." };
    const html = render(value, "codex");
    expect(html).toContain("Not connected");
    expect(html).toContain("dot err");
    expect(html).toContain('role="alert"');
    expect(html).toContain("The sign-in timed out.");
    expect(html).toContain("Try browser again");
    expect(html).toContain("Try a device code");
  });

  test("unavailable and checking providers say so", () => {
    const value = snapshot();
    value.providers[1] = { id: "codex", name: "Codex", configured: true, verified: false, availability: "unavailable", detail: "Codex could not be reached." };
    expect(render(value, "codex")).toContain("Unavailable");
    expect(render(value, "codex")).toContain("Codex could not be reached.");
    value.providers[1] = { id: "codex", name: "Codex", configured: true, verified: false, availability: "checking" };
    expect(render(value, "codex")).toContain("Checking…");
  });
});

type Harness = { host: HTMLElement; calls: string[]; keys: string[]; setSnapshot: (next: RuntimeSnapshot) => Promise<void>; unmount: () => Promise<void> };

async function mount(initial: RuntimeSnapshot, viewId: ProviderId): Promise<Harness> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const calls: string[] = [];
  const keys: string[] = [];
  let push: (next: RuntimeSnapshot) => void = noop;
  function Wrapper() {
    const [value, setValue] = useState(initial);
    const [apiKey, setApiKey] = useState("");
    push = setValue;
    return <ProviderSettings snapshot={value} viewId={viewId} onViewChange={noop} apiKey={apiKey}
      setApiKey={(next) => { keys.push(next); setApiKey(next); }}
      onConnect={(event) => { event.preventDefault(); calls.push(`connect:${apiKey}`); }}
      onDisconnect={(id) => calls.push(`disconnect:${id}`)} onStartCodexAuth={(mode) => calls.push(`auth:${mode}`)}
      onSubmitCodexAuth={noop} onCancelCodexAuth={() => calls.push("cancel")} onSelectProvider={(id) => calls.push(`use:${id}`)} />;
  }
  const root = createRoot(host);
  await act(async () => root.render(<Wrapper />));
  return { host, calls, keys, setSnapshot: async (next) => { await act(async () => push(next)); }, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}

// react-dom loads before the test DOM exists, so it cannot see native "input" events; its fallback is focus + keyup.
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: value.slice(-1), bubbles: true }));
  });
};

describe("provider settings behaviour", () => {
  test("typing clears a rejected-key error", async () => {
    const value = disconnected(snapshot(), "openrouter");
    value.credential = { configured: true, verified: false };
    value.error = { code: "invalid-credential", message: "OpenRouter rejected that key.", retryable: false };
    const h = await mount(value, "openrouter");
    expect(h.host.querySelector('[role="alert"]')?.textContent).toBe("OpenRouter rejected that key.");
    await type(h.host.querySelector<HTMLInputElement>('input[type="password"]')!, "s");
    expect(h.host.querySelector('[role="alert"]')).toBeNull();
    expect(h.host.querySelector(".field-hint")).not.toBeNull();
    await h.unmount();
  });

  test("Replace key opens the field, a failed replacement keeps it open and the old key connected, a good one closes it", async () => {
    const h = await mount(snapshot(), "openrouter");
    const open = () => h.host.querySelector(".list-expand")!.classList.contains("is-open");
    expect(open()).toBe(false);
    await act(async () => Array.from(h.host.querySelectorAll("button")).find((b) => b.textContent === "Replace key")!.click());
    expect(open()).toBe(true);
    expect(h.host.querySelector<HTMLInputElement>('input[type="password"]')!.placeholder).toBe("Enter a replacement key");
    expect(Array.from(h.host.querySelectorAll("button")).some((b) => b.textContent === "Cancel")).toBe(true);

    await h.setSnapshot({ ...snapshot(), status: "validating-key" });
    expect(h.host.textContent).toContain("Checking…");
    await h.setSnapshot({ ...snapshot(), error: { code: "invalid-credential", message: "That replacement was rejected.", retryable: false } });
    expect(open()).toBe(true);
    expect(h.host.querySelector('[role="alert"]')?.textContent).toBe("That replacement was rejected.");
    expect(h.host.textContent).toContain("Connected");

    await h.setSnapshot({ ...snapshot(), status: "validating-key" });
    await h.setSnapshot(snapshot());
    expect(open()).toBe(false);
    await h.unmount();
  });

  test("Cancel closes the replacement field", async () => {
    const h = await mount(snapshot(), "openrouter");
    await act(async () => Array.from(h.host.querySelectorAll("button")).find((b) => b.textContent === "Replace key")!.click());
    await act(async () => Array.from(h.host.querySelectorAll("button")).find((b) => b.textContent === "Cancel")!.click());
    expect(h.host.querySelector(".list-expand")!.classList.contains("is-open")).toBe(false);
    await h.unmount();
  });

  test("row actions call the matching handlers", async () => {
    const h = await mount(snapshot(), "openrouter");
    const click = (label: string) => act(async () => Array.from(h.host.querySelectorAll("button")).find((b) => b.textContent === label)!.click());
    await click("Use");
    await click("Disconnect");
    expect(h.calls).toEqual(["use:openrouter", "disconnect:openrouter"]);
    await h.unmount();
    const c = await mount(disconnected(snapshot(), "codex"), "codex");
    await act(async () => Array.from(c.host.querySelectorAll("button")).find((b) => b.textContent === "Sign in")!.click());
    await act(async () => Array.from(c.host.querySelectorAll("button")).find((b) => b.textContent === "Use a device code")!.click());
    expect(c.calls).toEqual(["auth:browser", "auth:device"]);
    await c.unmount();
  });
});
