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
      subscribeToThread: async () => ({ stream: pendingChunks(), activeRunId: () => "run-active", abort: () => (aborted = true), unsubscribe: () => undefined }),
      queueMessage: () => ({ accepted: Promise.resolve({ action: "deliver", runId: "run-active" }) }),
    };
    const driver = new NativeAgentDriver(agent, "local-user", { onProjection: () => undefined, onQueueChanged: (_threadId, count) => counts.push(count) });
    expect(await driver.queue("thread-1", "next")).toEqual({ runId: "run-active", queued: true });
    expect(driver.queuedCount("thread-1")).toBe(1);
    expect(driver.abort("thread-1")).toBeTrue();
    expect(aborted).toBeTrue();
    expect(counts).toEqual([1]);
  });
});
