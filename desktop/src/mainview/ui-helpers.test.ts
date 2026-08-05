import { describe, expect, it } from "bun:test";
import type { ThreadSummary, WorkbenchState } from "../shared/contracts";
import { conversationGroupForDate, goalFromMessages, groupAssistantPartRuns, groupConversationItems, groupThreads, relativeTime, shouldShowWorkbench } from "./ui-helpers";

const now = new Date("2026-08-03T12:00:00.000Z");
const thread = (id: string, title: string, updatedAt: string): ThreadSummary => ({
  id,
  title,
  createdAt: updatedAt,
  updatedAt,
  activity: "idle",
  attention: 0,
});
const emptyWorkbench = (overrides: Partial<WorkbenchState> = {}): WorkbenchState => ({
  status: "idle",
  tasks: [],
  pendingInteractions: [],
  queuedFollowUpCount: 0,
  tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  ...overrides,
});

describe("conversation helpers", () => {
  it("groups and filters recent conversations", () => {
    const groups = groupThreads([thread("old", "Old work", "2026-07-20T12:00:00.000Z"), thread("today", "OpenRouter chat", "2026-08-03T11:30:00.000Z"), thread("week", "Another chat", "2026-07-31T12:00:00.000Z")], "open", now);
    expect(groups).toEqual([
      {
        name: "Today",
        threads: [thread("today", "OpenRouter chat", "2026-08-03T11:30:00.000Z")],
      },
    ]);
    expect(conversationGroupForDate("2026-07-20T12:00:00.000Z", now)).toBe("Older");
  });

  it("formats relative timestamps and derives a local goal", () => {
    expect(relativeTime("2026-08-03T11:59:00.000Z", now)).toBe("1m");
    expect(
      goalFromMessages([
        {
          id: "1",
          role: "user",
          text: "  Make the Workbench feel quieter.  ",
          turnId: "1",
          parts: [
            {
              type: "text",
              id: "1:text:0",
              text: "  Make the Workbench feel quieter.  ",
            },
          ],
          status: "complete",
          createdAt: now.toISOString(),
        },
      ]),
    ).toBe("Make the Workbench feel quieter.");
  });

  it("keeps assistant text and tools chronological while collapsing repeated tool updates by call id", () => {
    const base = {
      role: "assistant" as const,
      turnId: "user-1",
      status: "complete" as const,
      createdAt: now.toISOString(),
    };
    const items = groupConversationItems([
      {
        ...base,
        id: "a-1",
        text: "First",
        parts: [
          { type: "text", id: "a-1:text:0", text: "First" },
          {
            type: "tool",
            id: "a-1:tool:1",
            toolCallId: "call-1",
            name: "search",
            label: "Search",
            status: "running",
          },
        ],
      },
      {
        ...base,
        id: "a-2",
        text: "Second",
        parts: [
          {
            type: "tool",
            id: "a-2:tool:1",
            toolCallId: "call-1",
            name: "search",
            label: "Search",
            status: "completed",
            outputSummary: "Found it",
          },
          { type: "text", id: "a-2:text:1", text: "Second" },
        ],
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "assistant",
      parts: [
        { type: "text", text: "First" },
        { type: "tool", toolCallId: "call-1", status: "completed" },
        { type: "text", text: "Second" },
      ],
    });
  });

  it("creates tool runs before the terminal assistant message", () => {
    const runs = groupAssistantPartRuns([
      { type: "tool", id: "tool-1", toolCallId: "call-1", name: "task_write", label: "Created task list", status: "completed" },
      { type: "tool", id: "tool-2", toolCallId: "call-2", name: "task_complete", label: "Completed task", status: "completed" },
      { type: "text", id: "final", text: "All tasks are complete." },
    ]);

    expect(runs).toEqual([
      {
        type: "tools",
        tools: [
          { type: "tool", id: "tool-1", toolCallId: "call-1", name: "task_write", label: "Created task list", status: "completed" },
          { type: "tool", id: "tool-2", toolCallId: "call-2", name: "task_complete", label: "Completed task", status: "completed" },
        ],
      },
      { type: "text", part: { type: "text", id: "final", text: "All tasks are complete." } },
    ]);
  });
});

describe("Workbench visibility policy", () => {
  it("stays hidden for an empty idle state", () => {
    expect(shouldShowWorkbench(emptyWorkbench())).toBe(false);
  });

  it("opens for real structured work and completed review state", () => {
    expect(
      shouldShowWorkbench(
        emptyWorkbench({
          tasks: [
            {
              id: "1",
              content: "Review",
              activeForm: "Reviewing",
              status: "in_progress",
            },
          ],
        }),
      ),
    ).toBe(true);
    expect(shouldShowWorkbench(emptyWorkbench({ status: "complete", goal: "Review the result" }))).toBe(true);
  });

  it("stays relevant for waiting and terminal review states", () => {
    for (const status of ["waiting", "interrupted", "error"] as const) {
      expect(shouldShowWorkbench(emptyWorkbench({ status }))).toBe(true);
    }
    expect(shouldShowWorkbench(emptyWorkbench({ tokenUsage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 } }))).toBe(true);
  });
});
