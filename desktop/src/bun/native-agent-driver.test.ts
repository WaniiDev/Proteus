import { describe, expect, test } from "bun:test";
import { NativeAgentDriver, type NativeQueueAgent } from "./native-agent-driver";

async function* noChunks() {}
async function* pendingChunks() { await new Promise<void>(() => undefined); }

describe("native Mastra agent driver", () => {
  test("uses queueMessage and consumes a natively woken stream", async () => {
    let consumed = false;
    const calls: unknown[] = [];
    const agent: NativeQueueAgent = {
      subscribeToThread: async () => ({ stream: noChunks(), activeRunId: () => null, abort: () => true, unsubscribe: () => undefined }),
      queueMessage: (message, options) => {
        calls.push({ message, options });
        return { accepted: Promise.resolve({ action: "wake", runId: "run-1", output: { consumeStream: async () => { consumed = true; } } }) };
      },
      sendStreamResume: async ({ runId, toolCallId }) => ({ accepted: true, runId, toolCallId }),
    };
    const driver = new NativeAgentDriver(agent, "local-user", { onProjection: () => undefined });
    expect(await driver.queue("thread-1", "hello", { clientMessageId: "client-1" })).toEqual({ runId: "run-1", queued: false });
    await Promise.resolve();
    expect(consumed).toBeTrue();
    expect(calls).toEqual([{ message: { contents: "hello", metadata: { clientMessageId: "client-1" } }, options: { resourceId: "local-user", threadId: "thread-1" } }]);
  });

  test("mirrors native queued count and delegates abort", async () => {
    let aborted = false;
    const counts: number[] = [];
    const agent: NativeQueueAgent = {
      subscribeToThread: async () => ({ stream: pendingChunks(), activeRunId: () => null, abort: () => (aborted = true), unsubscribe: () => undefined }),
      queueMessage: () => ({ accepted: Promise.resolve({ action: "deliver", runId: "run-queued" }) }),
      sendStreamResume: async ({ runId, toolCallId }) => ({ accepted: true, runId, toolCallId }),
    };
    const driver = new NativeAgentDriver(agent, "local-user", { onProjection: () => undefined, onQueueChanged: (_threadId, count) => counts.push(count) });
    expect(await driver.queue("thread-1", "next")).toEqual({ runId: "run-queued", queued: true });
    expect(driver.queuedCount("thread-1")).toBe(1);
    expect(driver.abort("thread-1")).toBeTrue();
    expect(aborted).toBeTrue();
    expect(counts).toEqual([1]);
  });

  test("acknowledges native suspension resumption without waiting for run completion", async () => {
    const resumes: unknown[] = [];
    const agent: NativeQueueAgent = {
      subscribeToThread: async () => ({ stream: noChunks(), activeRunId: () => null, abort: () => false, unsubscribe: () => undefined }),
      queueMessage: () => ({ accepted: Promise.resolve({ action: "discard" }) }),
      sendStreamResume: async (options) => {
        resumes.push(options);
        return { accepted: true, runId: options.runId, toolCallId: options.toolCallId };
      },
    };
    const driver = new NativeAgentDriver(agent, "local-user", { onProjection: () => undefined });
    expect(await driver.resume("thread-1", "run-1", "call-1", { action: "approved" }, { activeTools: ["task_write"] })).toEqual({ runId: "run-1" });
    expect(resumes).toEqual([{ resourceId: "local-user", threadId: "thread-1", runId: "run-1", toolCallId: "call-1", resumeData: { action: "approved" }, streamOptions: { activeTools: ["task_write"] } }]);
  });

  test("rediscovers durable suspensions and uses native tool approval", async () => {
    const approvals: unknown[] = [];
    const agent: NativeQueueAgent = {
      subscribeToThread: async () => ({ stream: noChunks(), activeRunId: () => null, abort: () => false, unsubscribe: () => undefined }),
      queueMessage: () => ({ accepted: Promise.resolve({ action: "discard" }) }),
      sendStreamResume: async ({ runId, toolCallId }) => ({ accepted: true, runId, toolCallId }),
      listSuspendedRuns: async () => ({ runs: [{ runId: "run-durable", toolCalls: [{ toolCallId: "call-durable", requiresApproval: true }] }] }),
      sendToolApproval: async (options) => {
        approvals.push(options);
        return { accepted: true, runId: "run-durable", toolCallId: options.toolCallId };
      },
    };
    const driver = new NativeAgentDriver(agent, "local-user", { onProjection: () => undefined });
    expect(await driver.findSuspension("thread-1", "call-durable")).toEqual({ runId: "run-durable", toolCallId: "call-durable", requiresApproval: true });
    expect(await driver.approve("thread-1", "call-durable", true)).toEqual({ runId: "run-durable" });
    expect(approvals).toEqual([{ resourceId: "local-user", threadId: "thread-1", toolCallId: "call-durable", approved: true }]);
  });
});
