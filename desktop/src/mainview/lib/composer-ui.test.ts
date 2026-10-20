import { describe, expect, it } from "bun:test";
import type { ChatMessage, RuntimeSnapshot } from "../../shared/contracts";
import { canChooseComposerWorkspace, composerAction, composerModelLabel, deriveIsland, islandStatus, reconcileQueuedDrafts, selectedProviderCanChat, shouldSubmitComposerKey, type QueuedDraft } from "./composer-ui";

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
      continuation: null,
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
      activeRun: null, continuation: null, error: null,
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
      activeRun: null, continuation: null, error: null,
    } satisfies RuntimeSnapshot;
    expect(composerModelLabel(snapshot)).toBe("Codex · GPT-5.6 Sol · high");
  });

  it("keeps the composer metadata minimal and centers its action at the right edge", async () => {
    const app = await Bun.file(new URL("../views/Companion.tsx", import.meta.url)).text();
    const composer = await Bun.file(new URL("../components/Composer.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("../index.css", import.meta.url)).text();

    expect(app).not.toContain("Active conversation");
    expect(app).not.toContain("via OpenRouter");
    expect(app).toContain("<Composer");
    expect(composer).toContain("composer-project-popover");
    expect(composer).toContain("composer-model-popover");
    expect(composer).toContain('aria-label={provider.name}');
    expect(composer).toContain('<ProviderMark provider={provider.id}');
    expect(composer).toContain("<span>{provider.name}</span>");
    expect(composer).not.toContain("model.description ?? model.rawId");
    expect(composer).not.toContain('<i className={provider.availability}');
    expect(composer).toContain("<Island");
    expect(css).not.toContain(".composer-primary");
    expect(css).not.toContain(".composer-input");
    expect(css).toContain(".composer-controls { min-width: 0;");
    expect(css).toContain(".composer-popover { position: absolute; bottom: calc(100% + 8px)");
    expect(css).toContain(".composer-model-popover { width: 560px; max-width: calc(100vw - 48px)");
    expect(css).not.toContain(".composer-provider-tabs i.ready");
  });

  it("reconciles identical queued text FIFO and marks a draining item", () => {
    const drafts = [draft("1", "Same"), draft("2", "Same")];
    expect(reconcileQueuedDrafts(drafts, [], "thread-1", 1).map((item) => item.state)).toEqual(["sending", "queued"]);
    expect(reconcileQueuedDrafts(drafts, [user("stored", "Same", "2026-08-04T00:00:03.000Z")], "thread-1", 1).map((item) => item.id)).toEqual(["2"]);
  });

  it("drops previews when the native session switches away", () => {
    expect(reconcileQueuedDrafts([draft("1")], [], "thread-2", 0)).toEqual([]);
  });

  describe("Island variants", () => {
    const base = (): RuntimeSnapshot => ({
      revision: 1, status: "ready", credential: { configured: true, verified: true }, providerAuth: null,
      providers: [{ id: "codex", name: "Codex", configured: true, verified: true, availability: "ready" }],
      models: [], selectedProviderId: "codex", selectedModelId: "codex/x", selectedReasoningEffort: null,
      projects: [], activeWorkspace: { binding: { kind: "app" }, label: "Proteus workspace", availability: "ready" },
      threads: [], activeThreadId: "thread-1", retryMessageId: null, messages: [], events: [], interactions: [],
      workbench: { status: "idle", tasks: [], pendingInteractions: [], queuedFollowUpCount: 0, tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
      activeRun: null, continuation: null, error: null,
    } as unknown as RuntimeSnapshot);
    const args = (snapshot: RuntimeSnapshot, overrides: Partial<Parameters<typeof deriveIsland>[0]> = {}) => ({ snapshot, orbState: "idle" as const, input: "", canChat: true, runningForSelected: false, runningElsewhere: false, providerName: "Codex", queuedDraftCount: 0, ...overrides });

    it("shows the input with Send disabled until there is text", () => {
      expect(deriveIsland(args(base()))).toMatchObject({ mode: "input", end: "send", sendDisabled: true, placeholder: "Ask Proteus anything" });
      expect(deriveIsland(args(base(), { input: "hi" }))).toMatchObject({ mode: "input", sendDisabled: false, sendLabel: "Send" });
    });

    it("asks a follow-up once the conversation has messages and explains a disabled input", () => {
      const snapshot = base();
      snapshot.messages = [user("1", "Hello", "2026-08-04T00:00:01.000Z")];
      expect(deriveIsland(args(snapshot)).placeholder).toBe("Ask a follow-up…");
      expect(deriveIsland(args(snapshot, { canChat: false })).placeholder).toBe("Configure Codex in Settings to chat");
      expect(deriveIsland(args(snapshot, { canChat: false, runningElsewhere: true })).placeholder).toBe("Another conversation is running…");
    });

    it("switches to status and Stop while a run is going, naming the live step and the queue", () => {
      const snapshot = base();
      snapshot.activeRun = { runId: "run-1", threadId: "thread-1", status: "running" };
      snapshot.workbench.queuedFollowUpCount = 2;
      const view = deriveIsland(args(snapshot, { runningForSelected: true, orbState: "thinking" }));
      expect(view).toMatchObject({ mode: "status", end: "stop", status: { label: "Thinking", line: "Thinking… · 2 queued" } });
      expect(islandStatus(snapshot, "idle").label).toBe("Working");
    });

    it("keeps the input for a draft typed during a run and labels Send as a queue action", () => {
      const snapshot = base();
      snapshot.activeRun = { runId: "run-1", threadId: "thread-1", status: "running" };
      expect(deriveIsland(args(snapshot, { runningForSelected: true, input: "next" }))).toMatchObject({ mode: "input", end: "send", sendLabel: "Queue message", sendDisabled: false });
    });

    it("shows the ask kicker when an interaction needs the person", () => {
      const snapshot = base();
      snapshot.interactions = [{ id: "i1", toolCallId: "t1", kind: "tool_approval", toolName: "mastra_workspace_edit_file", args: { path: "docs/plan.md" }, title: "Allow mastra_workspace_edit_file?", options: [], status: "pending", createdAt: "2026-08-04T00:00:00.000Z" }];
      expect(deriveIsland(args(snapshot))).toMatchObject({ mode: "ask", askKind: "Edit file" });
      snapshot.interactions.push({ id: "i2", toolCallId: "t2", kind: "ask_user", title: "Who?", options: [], status: "pending", createdAt: "2026-08-04T00:00:01.000Z" });
      expect(deriveIsland(args(snapshot)).askKind).toBe("Edit file · 1 of 2");
      snapshot.interactions.pop();
      snapshot.interactions[0]!.status = "approved";
      expect(deriveIsland(args(snapshot)).mode).toBe("input");
    });
  });
});
