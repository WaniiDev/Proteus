import { describe, expect, test } from "bun:test";
import type { ChatMessagePart } from "../../shared/contracts";
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

  test("marks structured validation failures as errors instead of completed", () => {
    const projector = new NativeStreamProjector();
    const failed = projector.apply("thread-1", {
      type: "tool-result",
      runId: "run-1",
      payload: {
        toolCallId: "call-1",
        toolName: "mastra_workspace_execute_command",
        result: { error: true, message: "Tool input validation failed" },
      },
    });
    expect(failed?.message.parts[0]).toMatchObject({
      type: "tool",
      status: "error",
      error: "Tool input validation failed",
    });
  });

  test("accumulates text and maps aborts and errors to terminal UI state", () => {
    const projector = new NativeStreamProjector();
    projector.apply("thread-1", { type: "text-delta", runId: "run-1", payload: { id: "text-1", text: "Hel" } });
    expect(projector.apply("thread-1", { type: "text-delta", runId: "run-1", payload: { id: "text-1", text: "lo" } })?.message.text).toBe("Hello");
    expect(projector.apply("thread-1", { type: "abort", runId: "run-1", payload: {} })?.message.status).toBe("interrupted");
    expect(projector.apply("thread-2", { type: "error", runId: "run-2", payload: { error: { details: { errorMessage: "boom" } } } })).toMatchObject({
      terminal: "error",
      terminalError: "boom",
      message: { status: "error" },
    });
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

  describe("show_answer streaming (ADR 0003)", () => {
    const answer = {
      v: 2,
      title: "Your week",
      blocks: [
        { type: "headline", text: "Three things need you" },
        { type: "list", label: "To do", rows: [{ id: "r1", title: "Reply to Sam" }, { id: "r2", title: "Book flights", act: { label: "Open", intent: "open", done: "Opened" } }] },
        { type: "text", text: "That is all." },
      ],
    };
    const json = JSON.stringify(answer);
    const run = () => {
      const projector = new NativeStreamProjector();
      const feed = (type: string, payload: Record<string, unknown>) => projector.apply("t", { type, runId: "run-1", payload: { toolCallId: "c1", toolName: "show_answer", ...payload } });
      const answerOf = (projection: ReturnType<typeof feed>) => projection?.message.parts.find((part) => part.type === "answer") as Extract<ChatMessagePart, { type: "answer" }> | undefined;
      feed("tool-call-input-streaming-start", {});
      return { projector, feed, answerOf };
    };
    const chunks = (text: string, size: number) => Array.from({ length: Math.ceil(text.length / size) }, (_, index) => text.slice(index * size, index * size + size));

    test("projects block by block and row by row, never a half-parsed block", () => {
      const { feed, answerOf } = run();
      const seen: string[] = [];
      for (const piece of chunks(json, 3)) {
        const part = answerOf(feed("tool-call-delta", { argsTextDelta: piece }));
        expect(part?.streaming).toBe(true);
        for (const block of part?.blocks ?? []) {
          expect(block.type).not.toBe("fallback");
          // Anything projected is already a complete, valid block (or a valid prefix of rows).
          if (block.type === "list") expect(block.rows.every((row) => typeof row.id === "string" && typeof row.title === "string")).toBe(true);
        }
        seen.push(JSON.stringify(part?.blocks.map((block) => block.type === "list" ? `list:${block.rows.length}` : block.type)));
      }
      const steps = [...new Set(seen)];
      expect(steps).toEqual(['[]', '["headline"]', '["headline","list:1"]', '["headline","list:2"]', '["headline","list:2","text"]']);
      const done = answerOf(feed("tool-call", { args: answer }));
      expect(done).toMatchObject({ title: "Your week", streaming: false, answerId: "c1", outcomes: {} });
      expect(done?.blocks.map((block) => block.type)).toEqual(["headline", "list", "text"]);
    });

    test("an invalid block mid-stream becomes a fallback and the answer continues", () => {
      const { feed, answerOf } = run();
      const bad = { ...answer, blocks: [answer.blocks[0], { type: "text", text: "see [x](http://a.b)" }, answer.blocks[2]] };
      let last;
      for (const piece of chunks(JSON.stringify(bad), 5)) last = answerOf(feed("tool-call-delta", { argsTextDelta: piece }));
      expect(last?.blocks as unknown[]).toEqual([answer.blocks[0], { type: "fallback" }, answer.blocks[2]]);
      expect(answerOf(feed("tool-call", { args: bad }))?.blocks).toEqual(last?.blocks);
    });

    test("an invalid row keeps its block out of the snapshot until the block completes as a fallback", () => {
      const { feed, answerOf } = run();
      const text = '{"v":2,"title":"T","blocks":[{"type":"list","label":"L","rows":[{"id":"a","title":"ok"},{"id":"b"}';
      expect(answerOf(feed("tool-call-delta", { argsTextDelta: text }))?.blocks.map((b) => b.type)).toEqual(["list"]);
      const closed = answerOf(feed("tool-call-delta", { argsTextDelta: ']}' }));
      expect(closed?.blocks).toEqual([{ type: "fallback" }]);
    });

    test("a rejected composition drops the answer without any tool step and the retry streams a new one", () => {
      const { feed, answerOf } = run();
      feed("tool-call", { args: answer });
      const failed = feed("tool-result", { result: { ok: false, shown: false, retry: true, message: "The answer was not shown." } });
      expect(answerOf(failed)).toBeUndefined();
      expect(failed?.message.parts.filter((part) => part.type === "tool")).toHaveLength(0);
      expect(failed?.message.parts).toHaveLength(0);

      const retry = feed("tool-call", { toolCallId: "c2", args: answer });
      expect(retry?.message.parts.filter((part) => part.type === "answer")).toHaveLength(1);
      const ok = feed("tool-result", { toolCallId: "c2", result: { ok: true, shown: true } });
      expect(ok?.message.parts.filter((part) => part.type === "answer")).toHaveLength(1);
      expect(ok?.message.parts.filter((part) => part.type === "tool")).toHaveLength(0);
    });

    test("a valid answer is never a tool step, and a tool error drops it", () => {
      const { feed, answerOf } = run();
      feed("tool-call-input-streaming-start", {});
      const called = feed("tool-call", { args: answer });
      expect(called?.message.parts.map((part) => part.type)).toEqual(["answer"]);
      const errored = feed("tool-error", { error: "boom" });
      expect(answerOf(errored)).toBeUndefined();
      expect(errored?.message.parts.filter((part) => part.type === "tool")).toHaveLength(0);
    });

    test("loose input: an 11-block answer projects repaired, with invalid blocks as fallback", () => {
      const { feed, answerOf } = run();
      const many = { v: 2, title: "T", blocks: [answer.blocks[0], { type: "text", text: "<b>x</b>" }, ...Array.from({ length: 9 }, () => ({ type: "text", text: "ok" }))] };
      const part = answerOf(feed("tool-call", { args: many }));
      expect(part?.blocks).toHaveLength(10);
      expect(part?.blocks[0]?.type).toBe("headline");
      expect(part?.blocks[1]).toEqual({ type: "fallback" });
    });

    test("an aborted run stops streaming", () => {
      const { projector, feed, answerOf } = run();
      feed("tool-call-delta", { argsTextDelta: json.slice(0, 60) });
      const aborted = projector.apply("t", { type: "abort", runId: "run-1", payload: {} });
      expect(answerOf(aborted)?.streaming).toBe(false);
    });
  });
});
