import { describe, expect, it } from "bun:test";
import type { ChatToolPart, PendingInteraction } from "../../shared/contracts";
import { approveLabel, askCode, askQueue, askSentence, askTitle, askWhat, resolvedAsk, resolvedAsks } from "./ask-copy";

const at = (minute: number) => `2026-08-04T00:0${minute}:00.000Z`;
const ask = (over: Partial<PendingInteraction>): PendingInteraction => ({ id: "i1", toolCallId: "t1", kind: "tool_approval", title: "Allow x?", options: [], status: "pending", createdAt: at(0), ...over });
const edit = ask({ toolName: "mastra_workspace_edit_file", args: { path: "docs/plan.md", old_string: "Beta", new_string: "Launch" } });
const tool = (over: Partial<ChatToolPart>): ChatToolPart => ({ type: "tool", id: "x", toolCallId: "t1", name: "mastra_workspace_edit_file", label: "Edit", status: "completed", input: { path: "docs/plan.md" }, ...over });

describe("ask queue", () => {
  it("shows the oldest open ask first and keeps array order for equal times", () => {
    const queue = askQueue([ask({ id: "late", createdAt: at(3) }), ask({ id: "a", createdAt: at(1) }), ask({ id: "b", createdAt: at(1) }), ask({ id: "done", status: "approved", createdAt: at(0) })], null);
    expect(queue.map((item) => item.id)).toEqual(["a", "b", "late"]);
  });

  it("keeps resolving and failed asks, and drops other threads", () => {
    const queue = askQueue([ask({ id: "r", status: "resolving" }), ask({ id: "f", status: "failed", createdAt: at(1) }), ask({ id: "other", threadId: "t2", createdAt: at(2) }), ask({ id: "mine", threadId: "t1", createdAt: at(3) })], "t1");
    expect(queue.map((item) => item.id)).toEqual(["r", "f", "mine"]);
  });
});

describe("ask copy", () => {
  it("names the change, the verb and the consequence", () => {
    expect(askTitle(edit)).toBe("Edit docs/plan.md");
    expect(askWhat(edit)).toBe("Edit file");
    expect(approveLabel(edit)).toBe("Approve edit");
    expect(askSentence(edit)).toBe("Proteus will change this file in your workspace once you approve.");
    expect(askCode(edit)).toBe("- Beta\n+ Launch");
  });

  it("shows a command as typed, with secrets redacted, and falls back for unknown tools", () => {
    const run = ask({ toolName: "mastra_workspace_execute_command", args: { command: "curl -H 'Authorization: Bearer abc.def' x" } });
    expect(askTitle(run)).toContain("Run curl");
    expect(approveLabel(run)).toBe("Approve command");
    expect(askCode(run)).not.toContain("abc.def");
    const other = ask({ toolName: "web_fetch", args: { url: "https://example.com" } });
    expect(approveLabel(other)).toBe("Approve");
    expect(askCode(other)).toContain("https://example.com");
  });

  it("leaves questions, plans and recovery with their own title and sentence", () => {
    expect(askWhat(ask({ kind: "ask_user" }))).toBe("Question");
    expect(askWhat(ask({ kind: "submit_plan" }))).toBe("Plan");
    const failed = ask({ status: "failed", error: { code: "resume-failed", message: "Mastra could not resume this request.", retryable: true } });
    expect(askWhat(failed)).toBe("Recovery");
    expect(askSentence(failed)).toBe("Mastra could not resume this request.");
    expect(askCode(failed)).toBeUndefined();
  });
});

describe("resolved asks", () => {
  it("records an approval, a decline, a plan decision and an answered question from the tool part", () => {
    expect(resolvedAsk(tool({ status: "completed" }))).toMatchObject({ label: "Approved", title: "Edit docs/plan.md", tone: "ok" });
    expect(resolvedAsk(tool({ status: "error" }))).toMatchObject({ label: "Approved", tone: "muted" });
    expect(resolvedAsk(tool({ status: "error" }))!.title).toEndWith(" — failed");
    expect(resolvedAsk(tool({ status: "completed" }))!.title).not.toContain("failed");
    expect(resolvedAsk(tool({ status: "declined" }))).toMatchObject({ label: "Declined", title: "Edit docs/plan.md", tone: "muted" });
    expect(resolvedAsk(tool({ name: "submit_plan", input: { path: "plans/q3.md" }, status: "completed" }))).toMatchObject({ label: "Approved", title: "plans/q3.md" });
    expect(resolvedAsk(tool({ name: "submit_plan", input: { path: "plans/q3.md" }, status: "declined" }))).toMatchObject({ label: "Changes requested" });
    expect(resolvedAsk(tool({ name: "ask_user", input: { question: "Which environment?" }, status: "completed" }))).toMatchObject({ label: "Answered", title: "Which environment?" });
  });

  it("says nothing for open asks and for tools that never asked", () => {
    expect(resolvedAsk(tool({ status: "waiting" }))).toBeNull();
    expect(resolvedAsk(tool({ status: "running" }))).toBeNull();
    expect(resolvedAsk(tool({ name: "mastra_workspace_read_file", status: "completed" }))).toBeNull();
    expect(resolvedAsks([tool({ name: "mastra_workspace_read_file" }), tool({ toolCallId: "t2", status: "declined" })]).map((item) => item.id)).toEqual(["t2"]);
  });
});
