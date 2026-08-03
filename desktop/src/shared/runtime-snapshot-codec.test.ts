import { describe, expect, it } from "bun:test";
import {
  runtimeSnapshotSchema,
  type ProteusRPCSchema,
  type RuntimeSnapshot,
} from "./contracts";
import { decodeRuntimeSnapshot, encodeRuntimeSnapshot } from "./runtime-snapshot-codec";

const unicodeMarkdown = [
  "It looks like “awd” may have been a typo.",
  "That’s sweet—thank you! I think you meant “I love you.”",
  "ไทย: สวัสดีครับ",
  "日本語: こんにちは",
  "Emoji: 😀 🧑‍💻",
  "",
  "```ts",
  'const greeting = "สวัสดี 😀";',
  "```",
].join("\n");

const snapshot = runtimeSnapshotSchema.parse({
  status: "running",
  credential: { configured: true, verified: true },
  models: [{ id: "openrouter/auto", rawId: "auto", name: "Auto Router" }],
  selectedModelId: "openrouter/auto",
  threads: [{
    id: "thread-1",
    title: "日本語 😀",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:01.000Z",
    activity: "running",
    attention: 1,
  }],
  activeThreadId: "thread-1",
  messages: [
    {
      id: "message-1",
      role: "user",
      text: "Please preserve this: “quotes”, That’s, em—dash, ไทย, 日本語, 😀",
      status: "complete",
      createdAt: "2026-08-03T00:00:01.000Z",
    },
    {
      id: "message-2",
      role: "assistant",
      text: unicodeMarkdown,
      status: "streaming",
      createdAt: "2026-08-03T00:00:02.000Z",
      retryable: false,
    },
  ],
  events: [{
    id: "event-1",
    type: "system",
    text: "กำลังทำงาน… 日本語 😀",
    createdAt: "2026-08-03T00:00:02.000Z",
  }],
  interactions: [{
    id: "interaction-1",
    toolCallId: "tool-1",
    kind: "ask_user",
    title: "เลือกภาษา / Choose a language",
    question: "ใช้ภาษาไทยหรือ日本語ดี?",
    options: [{ label: "ไทย — Thai", description: "สวัสดีครับ" }],
    selectionMode: "single_select",
    status: "pending",
    createdAt: "2026-08-03T00:00:02.000Z",
  }],
  resolvedInteractions: [{
    id: "interaction-0",
    toolCallId: "tool-0",
    kind: "submit_plan",
    title: "Approved “plan”",
    options: [],
    plan: {
      version: 1,
      title: "日本語の計画",
      summary: "That’s complete—thank you!",
      steps: ["ตรวจสอบข้อความ", "確認する"],
      raw: "# 日本語の計画\n\nThat’s complete—thank you!",
      status: "approved",
      feedback: "Looks good — 完了",
    },
    status: "approved",
    createdAt: "2026-08-03T00:00:02.000Z",
  }],
  workbench: {
    status: "active",
    goal: "Preserve “quotes”, Thai ไทย, Japanese 日本語, and emoji 😀.",
    tasks: [{ id: "task-1", content: "ตรวจสอบ Unicode", activeForm: "กำลังตรวจสอบ", status: "in_progress" }],
    pendingInteractions: [],
    queuedFollowUps: [{ id: "queue-1", content: "Continue with 日本語 😀", createdAt: "2026-08-03T00:00:03.000Z" }],
    clearedFollowUps: [],
    tokenUsage: { promptTokens: 5, completionTokens: 8, totalTokens: 13 },
    activeTools: [{ id: "tool-2", name: "submit_plan", status: "running" }],
  },
  activeRun: { runId: "run-1", threadId: "thread-1", status: "running" },
  error: null,
}) as RuntimeSnapshot;

describe("RuntimeSnapshot Unicode transport", () => {
  it("round-trips Unicode, Markdown, code fences, and surrogate-pair emoji", () => {
    const envelope = encodeRuntimeSnapshot(snapshot);

    expect(JSON.stringify(envelope)).toMatch(/^[\x00-\x7F]*$/);
    expect(decodeRuntimeSnapshot(envelope)).toEqual(snapshot);
  });

  it("keeps bootstrap and runtime.changed payloads typed and ASCII-safe", () => {
    type BootstrapPayload = ProteusRPCSchema["bun"]["requests"]["runtime.bootstrap"]["response"];
    type ChangedPayload = ProteusRPCSchema["webview"]["messages"]["runtime.changed"];
    const bootstrapPayload: BootstrapPayload = encodeRuntimeSnapshot(snapshot);
    const changedPayload: ChangedPayload = encodeRuntimeSnapshot(snapshot);
    const bootstrapPacket = JSON.stringify({ type: "response", id: 1, success: true, payload: bootstrapPayload });
    const changedPacket = JSON.stringify({ type: "message", id: "runtime.changed", payload: changedPayload });

    expect(bootstrapPacket).toMatch(/^[\x00-\x7F]*$/);
    expect(changedPacket).toMatch(/^[\x00-\x7F]*$/);
    expect(decodeRuntimeSnapshot(bootstrapPayload)).toEqual(snapshot);
    expect(decodeRuntimeSnapshot(changedPayload)).toEqual(snapshot);
  });

  it("preserves each streamed partial snapshot", () => {
    const partials = ["That", "That’s sweet—", unicodeMarkdown];

    for (const text of partials) {
      const partial = {
        ...snapshot,
        messages: snapshot.messages.map((message) => message.id === "message-2" ? { ...message, text } : message),
      };
      expect(decodeRuntimeSnapshot(encodeRuntimeSnapshot(partial)).messages[1]?.text).toBe(text);
    }
  });

  it("rejects corrupted or unsupported envelopes", () => {
    const envelope = encodeRuntimeSnapshot(snapshot);

    expect(() => decodeRuntimeSnapshot({ ...envelope, version: 2 })).toThrow();
    expect(() => decodeRuntimeSnapshot({ ...envelope, data: "%%%%" })).toThrow();
    expect(() => decodeRuntimeSnapshot({ ...envelope, data: "eyJpbnZhbGlkIjp0cnVlfQ==" })).toThrow();
  });
});
