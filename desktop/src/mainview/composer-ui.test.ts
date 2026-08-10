import { describe, expect, it } from "bun:test";
import type { ChatMessage, RuntimeSnapshot } from "../shared/contracts";
import { canChooseComposerWorkspace, composerAction, composerLineCount, composerModelLabel, reconcileQueuedDrafts, selectedProviderCanChat, shouldSubmitComposerKey, type QueuedDraft } from "./composer-ui";

const draft = (id: string, text = `Message ${id}`): QueuedDraft => ({ id, threadId: "thread-1", text, createdAt: `2026-08-04T00:00:0${id}.000Z`, state: "queued" });
const user = (id: string, text: string, createdAt: string): ChatMessage => ({ id, role: "user", text, turnId: id, status: "complete", createdAt, parts: [{ type: "text", id: `${id}:text`, text }] });

describe("composer UI policy", () => {
  it("uses Send, Stop, and Queue for the three composer states", () => {
    expect(composerAction(false, true)).toBe("send");
    expect(composerAction(true, false)).toBe("stop");
    expect(composerAction(true, true)).toBe("queue");
  });

  it("allows a ready Codex model without an OpenRouter credential or OpenRouter runtime status", () => {
    const snapshot = {
      revision: 1,
      status: "error",
      credential: { configured: false, verified: false },
      providerAuth: null,
      providers: [
        { id: "openrouter", name: "OpenRouter", configured: false, verified: false, availability: "needs-configuration" },
        { id: "codex", name: "Codex", configured: true, verified: true, availability: "ready" },
      ],
      models: [{ id: "codex/gpt-5.3-codex-spark[xhigh]", providerId: "codex", rawId: "gpt-5.3-codex-spark[xhigh]", name: "GPT-5.3 Codex Spark (xhigh)", inputModalities: ["text"], outputModalities: ["text"] }],
      selectedProviderId: "codex",
      selectedModelId: "codex/gpt-5.3-codex-spark[xhigh]",
      selectedReasoningEffort: "xhigh",
      projects: [], activeWorkspace: { binding: { kind: "app" }, label: "Proteus workspace", availability: "ready" },
      threads: [], activeThreadId: "thread-1", retryMessageId: null, messages: [], events: [], interactions: [],
      workbench: { status: "idle", tasks: [], pendingInteractions: [], queuedFollowUpCount: 0, tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
      activeRun: null,
      error: { code: "model-unavailable", message: "Stale OpenRouter error", retryable: true },
    } satisfies RuntimeSnapshot;

    expect(selectedProviderCanChat(snapshot)).toBe(true);
    expect(selectedProviderCanChat({ ...snapshot, selectedProviderId: "openrouter", selectedModelId: "openrouter/auto", models: [{ id: "openrouter/auto", providerId: "openrouter", rawId: "auto", name: "Auto Router", inputModalities: ["text"], outputModalities: ["text"] }] })).toBe(false);
  });

  it("submits Enter but preserves Shift+Enter and IME composition", () => {
    expect(shouldSubmitComposerKey({ key: "Enter", shiftKey: false, isComposing: false })).toBe(true);
    expect(shouldSubmitComposerKey({ key: "Enter", shiftKey: true, isComposing: false })).toBe(false);
    expect(shouldSubmitComposerKey({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
  });

  it("maps explicit newlines directly to intrinsic textarea rows", () => {
    expect(composerLineCount("")).toBe(1);
    expect(composerLineCount("One line")).toBe(1);
    expect(composerLineCount("One\nTwo\nThree\nFour")).toBe(4);
    expect(composerLineCount("One\r\nTwo")).toBe(2);
  });

  it("shows project selection only for a truly empty idle conversation", () => {
    const snapshot = {
      revision: 1,
      status: "ready",
      credential: { configured: true, verified: true },
      providerAuth: null,
      providers: [{ id: "openrouter", name: "OpenRouter", configured: true, verified: true, availability: "ready" }],
      models: [{ id: "openrouter/auto", providerId: "openrouter", rawId: "auto", name: "Auto Router", inputModalities: ["text"], outputModalities: ["text"] }],
      selectedProviderId: "openrouter",
      selectedModelId: "openrouter/auto",
      selectedReasoningEffort: null,
      projects: [], activeWorkspace: { binding: { kind: "app" }, label: "Proteus workspace", availability: "ready" },
      threads: [], activeThreadId: "thread-1", retryMessageId: null, messages: [], events: [], interactions: [],
      workbench: { status: "idle", tasks: [], pendingInteractions: [], queuedFollowUpCount: 0, tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
      activeRun: null, error: null,
    } satisfies RuntimeSnapshot;

    expect(canChooseComposerWorkspace(snapshot, 0)).toBe(true);
    expect(canChooseComposerWorkspace({ ...snapshot, messages: [user("1", "Hello", new Date().toISOString())] }, 0)).toBe(false);
    expect(canChooseComposerWorkspace({ ...snapshot, activeRun: { runId: "run", threadId: "thread-1", status: "running" } }, 0)).toBe(false);
    expect(canChooseComposerWorkspace(snapshot, 1)).toBe(false);
  });

  it("formats provider, model, and optional thinking effort for the compact control", () => {
    const snapshot = {
      revision: 1, status: "ready", credential: { configured: false, verified: false }, providerAuth: null,
      providers: [{ id: "codex", name: "Codex", configured: true, verified: true, availability: "ready" }],
      models: [{ id: "codex/gpt-5.6-sol", providerId: "codex", rawId: "gpt-5.6-sol", name: "GPT-5.6 Sol", inputModalities: ["text"], outputModalities: ["text"] }],
      selectedProviderId: "codex", selectedModelId: "codex/gpt-5.6-sol", selectedReasoningEffort: "high",
      projects: [], activeWorkspace: { binding: { kind: "app" }, label: "Proteus workspace", availability: "ready" },
      threads: [], activeThreadId: "thread-1", retryMessageId: null, messages: [], events: [], interactions: [],
      workbench: { status: "idle", tasks: [], pendingInteractions: [], queuedFollowUpCount: 0, tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
      activeRun: null, error: null,
    } satisfies RuntimeSnapshot;
    expect(composerModelLabel(snapshot)).toBe("Codex · GPT-5.6 Sol · high");
  });

  it("keeps the composer metadata minimal and centers its action at the right edge", async () => {
    const app = await Bun.file(new URL("./App.tsx", import.meta.url)).text();
    const composer = await Bun.file(new URL("./Composer.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text();

    expect(app).not.toContain("Active conversation");
    expect(app).not.toContain("via OpenRouter");
    expect(app).toContain("<Composer");
    expect(composer).toContain("composer-project-popover");
    expect(composer).toContain("composer-model-popover");
    expect(css).toContain(".composer-primary { position: absolute; top: 50%; right: 11px;");
    expect(css).toContain("border-radius: 20px");
    expect(css).toContain(".composer-popover { position: absolute; bottom: calc(100% + 10px)");
    expect(css).toContain(".composer-model-popover { width: min(560px, calc(100% - 28px))");
  });

  it("reconciles identical queued text FIFO and marks a draining item", () => {
    const drafts = [draft("1", "Same"), draft("2", "Same")];
    expect(reconcileQueuedDrafts(drafts, [], "thread-1", 1).map((item) => item.state)).toEqual(["sending", "queued"]);
    expect(reconcileQueuedDrafts(drafts, [user("stored", "Same", "2026-08-04T00:00:03.000Z")], "thread-1", 1).map((item) => item.id)).toEqual(["2"]);
  });

  it("drops previews when the native session switches away", () => {
    expect(reconcileQueuedDrafts([draft("1")], [], "thread-2", 0)).toEqual([]);
  });
});
