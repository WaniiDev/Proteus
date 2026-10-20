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
  test("shows workspace and conversation model controls for an empty chat", () => {
    const html = render(snapshot());
    expect(html).toContain("Proteus workspace");
    expect(html).toContain("<span>GPT-5.6 Sol</span>");
    expect(html).toContain("Codex · GPT-5.6 Sol · high");
    expect(html).toContain('placeholder="Ask Proteus anything"');
    expect(html).toContain('class="island-meta"');
  });

  test("hides the workspace control once conversation history exists", () => {
    const value = snapshot();
    value.messages = [{ id: "user-1", turnId: "turn-1", role: "user", text: "Hello", status: "complete", createdAt: new Date().toISOString(), parts: [{ id: "part-1", type: "text", text: "Hello" }] }];
    expect(render(value)).not.toContain("Proteus workspace");
  });

  test("contains accessible provider, model, and dismissal behavior", async () => {
    const source = await Bun.file(new URL("./Composer.tsx", import.meta.url)).text();
    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="listbox"');
    expect(source).toContain('event.key !== "Escape"');
    expect(source).toContain('document.addEventListener("pointerdown"');
    expect(source).toContain('horizontal ? "ArrowRight" : "ArrowDown"');
    expect(source).toContain("Configure in Settings");
    expect(source).toContain("Provider default");
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
    expect((host.querySelector(".island-input") as HTMLTextAreaElement).disabled).toBe(true);
    await act(async () => { (host.querySelector(".island-end .btn") as HTMLButtonElement).click(); });
    expect(aborts).toBe(1);
    await act(async () => { root.unmount(); host.remove(); });
  });
});
