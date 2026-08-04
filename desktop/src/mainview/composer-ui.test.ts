import { describe, expect, it } from "bun:test";
import type { ChatMessage } from "../shared/contracts";
import { composerAction, composerInputHeight, reconcileQueuedDrafts, shouldSubmitComposerKey, type QueuedDraft } from "./composer-ui";

const draft = (id: string, text = `Message ${id}`): QueuedDraft => ({ id, threadId: "thread-1", text, createdAt: `2026-08-04T00:00:0${id}.000Z`, state: "queued" });
const user = (id: string, text: string, createdAt: string): ChatMessage => ({ id, role: "user", text, turnId: id, status: "complete", createdAt, parts: [{ type: "text", id: `${id}:text`, text }] });

describe("composer UI policy", () => {
  it("uses Send, Stop, and Queue for the three composer states", () => {
    expect(composerAction(false, true)).toBe("send");
    expect(composerAction(true, false)).toBe("stop");
    expect(composerAction(true, true)).toBe("queue");
  });

  it("submits Enter but preserves Shift+Enter and IME composition", () => {
    expect(shouldSubmitComposerKey({ key: "Enter", shiftKey: false, isComposing: false })).toBe(true);
    expect(shouldSubmitComposerKey({ key: "Enter", shiftKey: true, isComposing: false })).toBe(false);
    expect(shouldSubmitComposerKey({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
  });

  it("grows with content but caps the input at half the chat stage", () => {
    expect(composerInputHeight(22, 800)).toBe(24);
    expect(composerInputHeight(180, 800)).toBe(180);
    expect(composerInputHeight(620, 800)).toBe(400);
    expect(composerInputHeight(80, 0)).toBe(24);
    expect(composerInputHeight(24, 800, 4, 22)).toBe(92);
  });

  it("keeps the composer metadata minimal and centers its action at the right edge", async () => {
    const app = await Bun.file(new URL("./App.tsx", import.meta.url)).text();
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text();

    expect(app).not.toContain("Active conversation");
    expect(app).not.toContain("via OpenRouter");
    expect(css).toContain(".composer-primary { position: absolute; top: 50%; right: 11px;");
    expect(css).toContain("padding: 10px 60px 9px 12px");
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
