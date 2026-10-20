import { describe, expect, it } from "bun:test";
import type { ThreadSummary } from "../../shared/contracts";
import { conversationGroupForDate, goalFromMessages, groupAssistantPartRuns, groupConversationItems, groupSessions, groupThreads, relativeTime, shortDate } from "./ui-helpers";

const now = new Date("2026-08-03T12:00:00.000Z");
const thread = (id: string, title: string, updatedAt: string): ThreadSummary => ({
  id,
  pinned: false,
  pinnedAt: null,
  title,
  createdAt: updatedAt,
  updatedAt,
  activity: "idle",
  attention: 0,
  workspace: { binding: { kind: "app" }, label: "Proteus workspace", availability: "ready" },
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
    expect(relativeTime("2026-08-03T11:59:50.000Z", now)).toBe("now");
    expect(relativeTime("2026-08-03T08:30:00.000Z", now)).toBe("3h");
    expect(relativeTime("2026-07-31T12:00:00.000Z", now)).toBe("3d");
    expect(relativeTime("2026-07-25T12:00:00.000Z", now)).toBe("1w");
    expect(relativeTime("2026-06-01T12:00:00.000Z", now)).toBe("2mo");
    expect(relativeTime("2025-06-01T12:00:00.000Z", now)).toBe("1y");
    expect(relativeTime("nope", now)).toBe("");
  });

  it("writes project dates as today or a short date", () => {
    expect(shortDate("2026-08-03T01:00:00.000Z", now)).toBe("today");
    expect(shortDate("2026-06-02T12:00:00.000Z", now)).toBe("Jun 2");
    expect(shortDate("2025-09-02T12:00:00.000Z", now)).toBe("Sep 2, 2025");
    expect(shortDate("nope", now)).toBe("");
  });

  it("derives a local goal", () => {
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

  it("keeps and deduplicates source URLs while excluding them from text/tool runs", () => {
    const source = { type: "source-url" as const, id: "source-1", sourceId: "one", url: "https://example.com/docs", title: "Example docs" };
    const items = groupConversationItems([
      { id: "a", role: "assistant", text: "Answer", status: "complete", createdAt: now.toISOString(), turnId: "turn", parts: [{ type: "text", id: "text", text: "Answer" }, source] },
      { id: "b", role: "assistant", text: "", status: "complete", createdAt: now.toISOString(), turnId: "turn", parts: [{ ...source, id: "source-2", title: "Updated title" }] },
    ]);
    expect(items[0]).toMatchObject({ type: "assistant", parts: [{ type: "text", text: "Answer" }, { type: "source-url", title: "Updated title" }] });
    expect(groupAssistantPartRuns([{ type: "text", id: "text", text: "Answer" }, source])).toEqual([{ type: "text", part: { type: "text", id: "text", text: "Answer" } }]);
  });
});

describe("answer parts", () => {
  const answer = (streaming: boolean, blocks: number) => ({ type: "answer" as const, id: "a1:a", toolCallId: "a1", answerId: "a1", title: "Week", question: "", blocks: Array.from({ length: blocks }, () => ({ type: "text" as const, text: "x" })), streaming, outcomes: {} });
  const turn = (id: string, parts: ReturnType<typeof answer>[]) => ({ id, role: "assistant" as const, text: "", status: "complete" as const, createdAt: now.toISOString(), turnId: "turn", parts });

  it("keeps an answer in its place between text and tool runs", () => {
    const tool = { type: "tool" as const, id: "t", toolCallId: "t", name: "read", label: "Read", status: "completed" as const };
    const runs = groupAssistantPartRuns([tool, answer(false, 1), { type: "text", id: "x", text: "After" }]);
    expect(runs.map((run) => run.type)).toEqual(["tools", "answer", "text"]);
  });

  it("replaces an answer by its id as it streams in, across messages of one turn", () => {
    const items = groupConversationItems([turn("m1", [answer(true, 1)]), turn("m2", [answer(false, 3)])]);
    const parts = (items[0] as { parts: Array<{ type: string; streaming?: boolean; blocks?: unknown[] }> }).parts;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: "answer", streaming: false });
    expect(parts[0]!.blocks).toHaveLength(3);
  });
});

describe("sidebar groups", () => {
  it("puts pinned first, then Today and Earlier", () => {
    const pinned = { ...thread("p", "Pinned", "2026-06-01T12:00:00.000Z"), pinned: true, pinnedAt: "2026-08-01T00:00:00.000Z" };
    const groups = groupSessions([thread("old", "Old", "2026-07-20T12:00:00.000Z"), pinned, thread("new", "New", "2026-08-03T11:30:00.000Z")], now);
    expect(groups.map((g) => [g.name, g.threads.map((t) => t.id)])).toEqual([["Pinned", ["p"]], ["Today", ["new"]], ["Earlier", ["old"]]]);
  });
});
