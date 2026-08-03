import { describe, expect, it } from "bun:test";
import type { ThreadSummary, WorkbenchState } from "../shared/contracts";
import { conversationGroupForDate, goalFromMessages, groupThreads, relativeTime, shouldShowWorkbench } from "./ui-helpers";

const now = new Date("2026-08-03T12:00:00.000Z");
const thread = (id: string, title: string, updatedAt: string): ThreadSummary => ({ id, title, createdAt: updatedAt, updatedAt, activity: "idle", attention: 0 });
const emptyWorkbench = (overrides: Partial<WorkbenchState> = {}): WorkbenchState => ({
  status: "idle",
  tasks: [],
  pendingInteractions: [],
  queuedFollowUps: [],
  clearedFollowUps: [],
  tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  activeTools: [],
  ...overrides,
});

describe("conversation helpers", () => {
  it("groups and filters recent conversations", () => {
    const groups = groupThreads([
      thread("old", "Old work", "2026-07-20T12:00:00.000Z"),
      thread("today", "OpenRouter chat", "2026-08-03T11:30:00.000Z"),
      thread("week", "Another chat", "2026-07-31T12:00:00.000Z"),
    ], "open", now);
    expect(groups).toEqual([{ name: "Today", threads: [thread("today", "OpenRouter chat", "2026-08-03T11:30:00.000Z")] }]);
    expect(conversationGroupForDate("2026-07-20T12:00:00.000Z", now)).toBe("Older");
  });

  it("formats relative timestamps and derives a local goal", () => {
    expect(relativeTime("2026-08-03T11:59:00.000Z", now)).toBe("1m");
    expect(goalFromMessages([{ id: "1", role: "user", text: "  Make the Workbench feel quieter.  ", status: "complete", createdAt: now.toISOString() }])).toBe("Make the Workbench feel quieter.");
  });
});

describe("Workbench visibility policy", () => {
  it("stays hidden for an empty idle state", () => {
    expect(shouldShowWorkbench(emptyWorkbench())).toBe(false);
  });

  it("opens for real structured work and completed review state", () => {
    expect(shouldShowWorkbench(emptyWorkbench({ tasks: [{ id: "1", content: "Review", activeForm: "Reviewing", status: "in_progress" }] }))).toBe(true);
    expect(shouldShowWorkbench(emptyWorkbench({ status: "complete", goal: "Review the result" }))).toBe(true);
  });
});
