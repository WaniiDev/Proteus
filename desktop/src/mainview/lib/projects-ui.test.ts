import { describe, expect, test } from "bun:test";
import type { ThreadSummary } from "../../shared/contracts";
import { activityDotClass, chatCountLabel, projectThreadsFor } from "./projects-ui";

const thread = (id: string, projectId: string, updatedAt: string): ThreadSummary => ({
  id,
  pinned: false,
  pinnedAt: null,
  title: id,
  createdAt: updatedAt,
  updatedAt,
  activity: "idle",
  attention: 0,
  workspace: { binding: { kind: "project", projectId }, label: projectId, availability: "ready" },
});

describe("projects library and detail", () => {
  test("counts chats and maps activity to the design system dot", () => {
    expect(chatCountLabel(1)).toBe("1 chat");
    expect(chatCountLabel(0)).toBe("0 chats");
    expect([activityDotClass("running"), activityDotClass("waiting"), activityDotClass("error"), activityDotClass("complete"), activityDotClass("idle")]).toEqual(["dot run", "dot warn", "dot err", "dot ok", "dot"]);
  });

  test("shows only the selected project's chats with newest first", () => {
    const threads = [thread("old", "p1", "2026-08-01T00:00:00.000Z"), thread("other", "p2", "2026-08-10T00:00:00.000Z"), thread("new", "p1", "2026-08-09T00:00:00.000Z")];
    expect(projectThreadsFor(threads, "p1").map((item) => item.id)).toEqual(["new", "old"]);
  });
});
