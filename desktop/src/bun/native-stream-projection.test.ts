import { describe, expect, test } from "bun:test";
import { NativeStreamProjector } from "./native-stream-projection";

describe("native Mastra stream projection", () => {
  test("shows tool lifecycle events one by one and settles the turn", () => {
    const projector = new NativeStreamProjector();
    const base = { runId: "run-1", threadId: "thread-1" };
    projector.apply(base.threadId, { type: "start", runId: base.runId, payload: {} });
    const running = projector.apply(base.threadId, { type: "tool-call", runId: base.runId, payload: { toolCallId: "call-1", toolName: "task_write", args: { tasks: [] } } });
    expect(running?.message.parts[0]).toMatchObject({ type: "tool", status: "running", name: "task_write" });
    const completed = projector.apply(base.threadId, { type: "tool-result", runId: base.runId, payload: { toolCallId: "call-1", toolName: "task_write", result: { isError: false } } });
    expect(completed?.message.parts[0]).toMatchObject({ type: "tool", status: "completed" });
    const terminal = projector.apply(base.threadId, { type: "finish", runId: base.runId, payload: { totalUsage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } } });
    expect(terminal).toMatchObject({ terminal: "complete", usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 } });
  });

  test("accumulates text and maps aborts and errors to terminal UI state", () => {
    const projector = new NativeStreamProjector();
    projector.apply("thread-1", { type: "text-delta", runId: "run-1", payload: { id: "text-1", text: "Hel" } });
    expect(projector.apply("thread-1", { type: "text-delta", runId: "run-1", payload: { id: "text-1", text: "lo" } })?.message.text).toBe("Hello");
    expect(projector.apply("thread-1", { type: "abort", runId: "run-1", payload: {} })?.message.status).toBe("interrupted");
    expect(projector.apply("thread-2", { type: "error", runId: "run-2", payload: { error: new Error("boom") } })?.message.status).toBe("error");
  });

  test("keeps native approval calls visibly waiting until Mastra resumes them", () => {
    const projector = new NativeStreamProjector();
    const approval = projector.apply("thread-1", {
      type: "tool-call-approval",
      runId: "run-1",
      payload: { toolCallId: "call-1", toolName: "write_file", args: { path: "notes.md" } },
    });
    expect(approval?.message.parts[0]).toMatchObject({ type: "tool", status: "waiting", toolCallId: "call-1", name: "write_file" });
  });

  test("streams and deduplicates provider source URLs", () => {
    const projector = new NativeStreamProjector();
    projector.apply("thread-1", { type: "source-url", runId: "run-1", payload: { sourceId: "one", url: "https://example.com/docs", title: "Docs" } });
    const updated = projector.apply("thread-1", { type: "source-url", runId: "run-1", payload: { sourceId: "two", url: "https://example.com/docs", title: "Updated docs" } });
    expect(updated?.message.parts).toEqual([{ type: "source-url", id: "run-1:source:two", sourceId: "two", url: "https://example.com/docs", title: "Updated docs" }]);
  });
});
