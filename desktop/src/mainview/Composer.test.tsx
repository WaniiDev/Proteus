import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RuntimeSnapshot } from "../shared/contracts";
import { Composer } from "./Composer";

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
    expect(html).toContain("Codex · GPT-5.6 Sol · high");
    expect(html).toContain("Enter to send · Shift+Enter for new line");
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
});
