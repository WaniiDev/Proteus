import { describe, expect, it } from "bun:test";
import { runtimeSnapshotDecodeReportSchema, runtimeSnapshotSchema, type ProteusRPCSchema, type RuntimeSnapshot } from "./contracts";
import { decodeRuntimeSnapshot, describeRuntimeSnapshotDecodeFailure, encodeRuntimeSnapshot } from "./runtime-snapshot-codec";

const unicodeMarkdown = ["It looks like “awd” may have been a typo.", "That’s sweet—thank you! I think you meant “I love you.”", "ไทย: สวัสดีครับ", "日本語: こんにちは", "Emoji: 😀 🧑‍💻", "", "```ts", 'const greeting = "สวัสดี 😀";', "```"].join("\n");

const snapshot = runtimeSnapshotSchema.parse({
  status: "running",
  credential: { configured: true, verified: true },
  providers: [{ id: "openrouter", name: "OpenRouter", configured: true, verified: true, availability: "ready" }],
  models: [{ id: "openrouter/auto", providerId: "openrouter", rawId: "auto", name: "Auto Router" }],
  selectedProviderId: "openrouter",
  selectedModelId: "openrouter/auto",
  selectedReasoningEffort: null,
  threads: [
    {
      id: "thread-1",
      title: "日本語 😀",
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:01.000Z",
      activity: "running",
      attention: 1,
    },
  ],
  activeThreadId: "thread-1",
  messages: [
    {
      id: "message-1",
      role: "user",
      turnId: "message-1",
      parts: [
        {
          type: "text",
          id: "message-1:text:0",
          text: "preserved Unicode input",
        },
      ],
      text: "Please preserve this: “quotes”, That’s, em—dash, ไทย, 日本語, 😀",
      status: "complete",
      createdAt: "2026-08-03T00:00:01.000Z",
    },
    {
      id: "message-2",
      role: "assistant",
      text: unicodeMarkdown,
      turnId: "message-1",
      parts: [{ type: "text", id: "message-2:text:0", text: unicodeMarkdown }],
      status: "streaming",
      createdAt: "2026-08-03T00:00:02.000Z",
      retryable: false,
    },
  ],
  events: [
    {
      id: "event-1",
      type: "system",
      text: "กำลังทำงาน… 日本語 😀",
      createdAt: "2026-08-03T00:00:02.000Z",
    },
  ],
  interactions: [
    {
      id: "interaction-1",
      toolCallId: "tool-1",
      kind: "ask_user",
      title: "เลือกภาษา / Choose a language",
      question: "ใช้ภาษาไทยหรือ日本語ดี?",
      options: [{ label: "ไทย — Thai", description: "สวัสดีครับ" }],
      selectionMode: "single_select",
      status: "pending",
      createdAt: "2026-08-03T00:00:02.000Z",
    },
  ],
  resolvedInteractions: [
    {
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
    },
  ],
  workbench: {
    status: "active",
    goal: "Preserve “quotes”, Thai ไทย, Japanese 日本語, and emoji 😀.",
    tasks: [
      {
        id: "task-1",
        content: "ตรวจสอบ Unicode",
        activeForm: "กำลังตรวจสอบ",
        status: "in_progress",
      },
    ],
    pendingInteractions: [],
    queuedFollowUpCount: 1,
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
    const bootstrapPacket = JSON.stringify({
      type: "response",
      id: 1,
      success: true,
      payload: bootstrapPayload,
    });
    const changedPacket = JSON.stringify({
      type: "message",
      id: "runtime.changed",
      payload: changedPayload,
    });

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
        messages: snapshot.messages.map((message) => (message.id === "message-2" ? { ...message, text } : message)),
      };
      expect(decodeRuntimeSnapshot(encodeRuntimeSnapshot(partial)).messages[1]?.text).toBe(text);
    }
  });

  it("rejects corrupted or unsupported envelopes", () => {
    const envelope = encodeRuntimeSnapshot(snapshot);

    const cases = [
      { input: { ...envelope, version: 2 }, stage: "envelope" },
      { input: { ...envelope, data: "%%%%" }, stage: "base64" },
      { input: { ...envelope, data: "/w==" }, stage: "utf8" },
      { input: { ...envelope, data: "bm90LWpzb24=" }, stage: "json" },
      { input: { ...envelope, data: "eyJpbnZhbGlkIjp0cnVlfQ==" }, stage: "snapshot" },
    ] as const;

    for (const item of cases) {
      try {
        decodeRuntimeSnapshot(item.input);
        throw new Error("Expected decoding to fail");
      } catch (error) {
        const diagnostic = describeRuntimeSnapshotDecodeFailure(error, item.input);
        expect(diagnostic.stage).toBe(item.stage);
        expect(diagnostic.envelope.dataLength).toBe(item.input.data.length);
        expect(JSON.stringify(diagnostic)).not.toContain(item.input.data);
        expect(runtimeSnapshotDecodeReportSchema.safeParse({ origin: "runtime.changed", ...diagnostic }).success).toBeTrue();
      }
    }
  });
});
