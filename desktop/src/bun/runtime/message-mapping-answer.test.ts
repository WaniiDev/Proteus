import { describe, expect, test } from "bun:test";
import { NativeStreamProjector } from "../native/native-stream-projection";
import { projectMessageParts } from "./message-mapping";
import type { MastraMessage } from "./types";

const answer = {
  v: 2,
  title: "Your week",
  blocks: [
    { type: "headline", text: "Three things need you" },
    { type: "list", label: "To do", rows: [{ id: "r1", title: "Reply to Sam", act: { label: "Reply", intent: "reply", done: "Drafted" } }, { id: "r2", title: "Book flights", sub: "Before Friday" }] },
    { type: "text", text: "x".repeat(300) },
    { type: "text", text: "not <b>plain</b>" },
  ],
};

const stored = (output: unknown, state = "output-available") =>
  ({ id: "m1", role: "assistant", createdAt: new Date(), content: { format: 2, parts: [{ type: "tool-show_answer", toolCallId: "c1", state, input: answer, output }] } }) as unknown as MastraMessage;

describe("show_answer history", () => {
  test("a reload yields the same blocks as the finished stream", () => {
    const projector = new NativeStreamProjector();
    projector.apply("t", { type: "tool-call", runId: "r", payload: { toolCallId: "c1", toolName: "show_answer", args: answer } });
    const live = projector.apply("t", { type: "tool-result", runId: "r", payload: { toolCallId: "c1", toolName: "show_answer", result: { ok: true, shown: true } } })!.message.parts[0];
    const [reloaded] = projectMessageParts(stored({ ok: true, shown: true }));
    expect(live?.type).toBe("answer");
    expect(reloaded).toMatchObject({ type: "answer", answerId: "c1", title: "Your week", streaming: false, outcomes: {} });
    expect(reloaded).toMatchObject({ blocks: (live as { blocks: unknown[] }).blocks });
    expect((reloaded as { blocks: Array<{ type: string }> }).blocks.map((block) => block.type)).toEqual(["headline", "list", "text", "fallback"]);
  });

  test("nested rows survive history without truncation", () => {
    const [part] = projectMessageParts(stored({ ok: true, shown: true }));
    expect((part as { blocks: Array<{ rows?: Array<{ act?: unknown }> }> }).blocks[1]?.rows?.[0]?.act).toEqual({ label: "Reply", intent: "reply", done: "Drafted" });
  });

  test("a rejected or failed answer reloads as nothing, not a tool step", () => {
    expect(projectMessageParts(stored({ ok: false, shown: false, retry: true, message: "The answer was not shown." }))).toEqual([]);
    expect(projectMessageParts(stored({ error: true, message: "Tool input validation failed" }))).toEqual([]);
  });

  test("a valid answer is not also a tool row", () => {
    expect(projectMessageParts(stored({ ok: true, shown: true })).map((part) => part.type)).toEqual(["answer"]);
  });
});
