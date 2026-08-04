import { describe, expect, it } from "bun:test";
import type { ChatMessage } from "../shared/contracts";
import { composerAction, reconcileQueuedDrafts, shouldSubmitComposerKey, type QueuedDraft } from "./composer-ui";

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

  it("reconciles identical queued text FIFO and marks a draining item", () => {
    const drafts = [draft("1", "Same"), draft("2", "Same")];
    expect(reconcileQueuedDrafts(drafts, [], "thread-1", 1).map((item) => item.state)).toEqual(["sending", "queued"]);
    expect(reconcileQueuedDrafts(drafts, [user("stored", "Same", "2026-08-04T00:00:03.000Z")], "thread-1", 1).map((item) => item.id)).toEqual(["2"]);
  });

  it("drops previews when the native session switches away", () => {
    expect(reconcileQueuedDrafts([draft("1")], [], "thread-2", 0)).toEqual([]);
  });
});
