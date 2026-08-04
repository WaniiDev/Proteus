import { describe, expect, it } from "bun:test";
import type { ThreadSummary, WorkbenchState } from "../shared/contracts";
import { conversationGroupForDate, goalFromMessages, groupConversationItems, groupThreads, relativeTime, shouldShowWorkbench } from "./ui-helpers";

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

  it("keeps all assistant text segments and collapses repeated tool updates by call id", () => {
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
      textParts: [{ text: "First" }, { text: "Second" }],
      tools: [{ toolCallId: "call-1", status: "completed" }],
    });
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
});
