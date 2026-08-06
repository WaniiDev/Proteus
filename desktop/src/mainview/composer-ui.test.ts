import { describe, expect, it } from "bun:test";
import type { ChatMessage, RuntimeSnapshot } from "../shared/contracts";
import { composerAction, composerLineCount, reconcileQueuedDrafts, selectedProviderCanChat, shouldSubmitComposerKey, type QueuedDraft } from "./composer-ui";

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

  it("keeps the composer metadata minimal and centers its action at the right edge", async () => {
    const app = await Bun.file(new URL("./App.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text();

    expect(app).not.toContain("Active conversation");
    expect(app).not.toContain("via OpenRouter");
    expect(css).toContain(".composer-primary { position: absolute; top: 50%; right: 11px;");
    expect(css).toContain("padding: 10px 60px 9px 12px");
    expect(css).toContain("max-height: 154px");
    expect(css).toContain("max-height: 114px; field-sizing: content");
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
