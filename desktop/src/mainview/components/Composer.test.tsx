import { describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { useDom } from "../test/dom";
import type { RuntimeSnapshot } from "../../shared/contracts";
import { Composer } from "./Composer";

useDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const snapshot = (): RuntimeSnapshot => ({
  revision: 1,
  status: "ready",
  credential: { configured: true, verified: true },
  providerAuth: null,
  providers: [
    { id: "openrouter", name: "OpenRouter", configured: true, verified: true, availability: "ready" },
    { id: "codex", name: "Codex", configured: true, verified: true, availability: "ready" },
  ],
  models: [
    { id: "openrouter/auto", providerId: "openrouter", rawId: "auto", name: "Auto Router", inputModalities: ["text"], outputModalities: ["text"] },
    { id: "codex/gpt-5.6-sol", providerId: "codex", rawId: "gpt-5.6-sol", name: "GPT-5.6 Sol", reasoningOptions: ["low", "medium", "high", "xhigh"], inputModalities: ["text"], outputModalities: ["text"] },
  ],
  selectedProviderId: "codex",
  selectedModelId: "codex/gpt-5.6-sol",
  selectedReasoningEffort: "high",
  projects: [{ id: "project-1", name: "Proteus", rootPath: "C:\\Code\\Proteus", availability: "ready", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString() }],
  activeWorkspace: { binding: { kind: "app" }, label: "Proteus workspace", availability: "ready" },
  threads: [], activeThreadId: "thread-1", retryMessageId: null, messages: [], events: [], interactions: [],
  workbench: { status: "idle", tasks: [], pendingInteractions: [], queuedFollowUpCount: 0, tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
  activeRun: null,
  continuation: null,
  error: null,
});

const render = (value: RuntimeSnapshot) => renderToStaticMarkup(
  <Composer
    snapshot={value}
    input=""
    queuedDraftCount={0}
    canChat
    runningForSelected={false}
    runningElsewhere={false}
    providerName="Codex"
    orbState="idle"
    docked={false}
    orbAnchorRef={() => undefined}
    onInput={() => undefined}
    onSubmit={() => undefined}
    onAbort={() => undefined}
    onSettings={() => undefined}
    onNudge={() => undefined}
    onWorkspaceSelect={async () => ({ accepted: true })}
    onModelSelect={async () => true}
    onReasoningSelect={async () => true}
  />,
);

describe("Claude-style composer", () => {
  test("shows the project chip and the split model chip for an empty chat", () => {
    const html = render(snapshot());
    expect(html).toContain('class="island-meta"');
    expect(html).toContain("Proteus workspace");
    expect(html).toContain("GPT-5.6 Sol");
    expect(html).toContain('aria-label="Model GPT-5.6 Sol, high thinking. Change model."');
    expect(html).toContain("island-chip split");
    expect(html).toContain("chip-part chip-effort");
    expect(html).toContain('placeholder="Ask Proteus anything"');
  });

  test("locks the project chip once conversation history exists", () => {
    const value = snapshot();
    value.messages = [{ id: "user-1", turnId: "turn-1", role: "user", text: "Hello", status: "complete", createdAt: new Date().toISOString(), parts: [{ id: "part-1", type: "text", text: "Hello" }] }];
    const html = render(value);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("Fixed for this conversation.");
  });

  test("a running conversation shows the live status and Stop, which aborts the run", async () => {
    const value = snapshot();
    value.activeRun = { runId: "run-1", threadId: "thread-1", status: "running" };
    let aborts = 0;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(
      <Composer snapshot={value} input="" queuedDraftCount={0} canChat runningForSelected runningElsewhere={false} providerName="Codex" orbState="working" docked orbAnchorRef={() => undefined}
        onInput={() => undefined} onSubmit={() => undefined} onAbort={() => { aborts += 1; }} onSettings={() => undefined} onNudge={() => undefined}
        onWorkspaceSelect={async () => ({ accepted: true })} onModelSelect={async () => true} onReasoningSelect={async () => true} />,
    ));
    const visible = [...host.querySelectorAll(".island-status")].filter((el) => el.getAttribute("data-on") === "true");
    expect(visible.map((el) => el.querySelector("strong")?.textContent)).toEqual(["Working"]);
    const field = host.querySelector(".island-input") as HTMLTextAreaElement;
    expect(field.disabled).toBe(true);
    // The person can still reach the input during a run to queue a follow-up.
    await act(async () => { (host.querySelector(".island-status[data-on='true']") as HTMLElement).click(); });
    expect(field.disabled).toBe(false);
    expect(document.activeElement).toBe(field);
    await act(async () => { (host.querySelector(".island-end .btn") as HTMLButtonElement).click(); });
    expect(aborts).toBe(1);
    await act(async () => { root.unmount(); host.remove(); });
  });
});

describe("composer when the provider is not connected", () => {
  test("a warn notice sits above the Island and names the provider", () => {
    const html = renderToStaticMarkup(
      <Composer snapshot={snapshot()} input="" queuedDraftCount={0} canChat={false} runningForSelected={false} runningElsewhere={false} providerName="OpenRouter" orbState="idle" docked={false} orbAnchorRef={() => undefined} onInput={() => undefined} onSubmit={() => undefined} onAbort={() => undefined} onSettings={() => undefined} onNudge={() => undefined} onWorkspaceSelect={async () => ({ accepted: true })} onModelSelect={async () => true} onReasoningSelect={async () => true} />,
    );
    expect(html).toContain("island-notice");
    expect(html).toContain("OpenRouter isn’t connected.");
    expect(html).toContain("Open Settings");
    expect(render(snapshot())).not.toContain("island-notice");
  });
});
