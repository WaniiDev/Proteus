import { describe, expect, test } from "bun:test";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { RequestContext } from "@mastra/core/request-context";
import { createTool } from "@mastra/core/tools";
import { Memory } from "@mastra/memory";
import { MockLanguageModelV3 } from "ai/test";
import { simulateReadableStream } from "ai";
import { z } from "zod";
import { createProteusStorage } from "./mastra-foundation";

// `ai` bundles its own @ai-sdk/provider copy, so derive the chunk type from its mock instead of importing a second copy.
type LanguageModelV3StreamPart = Extract<NonNullable<ConstructorParameters<typeof MockLanguageModelV3>[0]>["doStream"], { stream: unknown }>["stream"] extends ReadableStream<infer P> ? P : never;

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 5_000)),
  ]);
}

async function exerciseDecision(approved: boolean) {
  const foundation = createProteusStorage(".", { inMemory: true });
  await foundation.appStorage.init();
  let executions = 0;
  let modelCall = 0;
  const protectedTool = createTool({
    id: "protected_operation",
    description: "A protected test operation",
    inputSchema: z.object({ value: z.string() }),
    outputSchema: z.object({ saved: z.boolean() }),
    requireApproval: true,
    execute: async () => {
      executions += 1;
      return { saved: true };
    },
  });
  const model = new MockLanguageModelV3({
    doStream: async () => {
      modelCall += 1;
      const chunks: LanguageModelV3StreamPart[] = modelCall === 1
        ? [
            { type: "stream-start", warnings: [] },
            { type: "tool-call", toolCallId: "call-protected", toolName: "protected_operation", input: JSON.stringify({ value: "test" }) },
            { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
          ]
        : [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "text-follow-up" },
            { type: "text-delta", id: "text-follow-up", delta: approved ? "Approved continuation." : "Declined continuation." },
            { type: "text-end", id: "text-follow-up" },
            { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
          ];
      return {
        stream: simulateReadableStream({
          chunks,
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      };
    },
  });
  const memory = new Memory({ storage: foundation.storage, vector: false, options: { lastMessages: 20, semanticRecall: false } });
  const agent = new Agent({ id: `approval-agent-${approved}`, name: "Approval test", instructions: "Use the protected tool, then respond.", model, memory, tools: { protected_operation: protectedTool } });
  const mastra = new Mastra({ storage: foundation.storage, agents: { approval: agent }, logger: false });
  const resourceId = "test-user";
  const threadId = `thread-${approved}`;
  const observed: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  let resolveApproval!: (toolCallId: string) => void;
  let resolveFinish!: () => void;
  const approvalSeen = new Promise<string>((resolve) => { resolveApproval = resolve; });
  const finished = new Promise<void>((resolve) => { resolveFinish = resolve; });
  const subscription = await agent.subscribeToThread({ resourceId, threadId });
  const consuming = (async () => {
    for await (const chunk of subscription.stream) {
      observed.push(chunk as { type: string; payload?: Record<string, unknown> });
      if (chunk.type === "tool-call-approval" && typeof chunk.payload?.toolCallId === "string") resolveApproval(chunk.payload.toolCallId);
      if (chunk.type === "finish") resolveFinish();
    }
  })();

  try {
    const queued = agent.queueMessage({ contents: "Run the protected operation." }, { resourceId, threadId });
    const accepted = await queued.accepted;
    if (accepted.action !== "wake") throw new Error(`Expected wake, received ${accepted.action}`);
    void accepted.output.consumeStream();
    const toolCallId = await withTimeout(approvalSeen, "approval request");
    const acknowledgement = await agent.sendToolApproval({ resourceId, threadId, toolCallId, approved, requestContext: new RequestContext() });
    await withTimeout(finished, "resumed completion");
    return { acknowledgement, executions, observed };
  } finally {
    subscription.unsubscribe();
    await consuming.catch(() => undefined);
    await mastra.shutdown();
    await foundation.appStorage.close();
  }
}

describe("installed Mastra tool approval", () => {
  test("decline acknowledges, skips execution, and continues the model turn", async () => {
    const result = await exerciseDecision(false);
    expect(result.acknowledgement.accepted).toBeTrue();
    expect(result.executions).toBe(0);
    expect(result.observed.map((chunk) => chunk.type)).toContain("text-delta");
  });

  test("approval executes exactly once and continues the model turn", async () => {
    const result = await exerciseDecision(true);
    expect(result.acknowledgement.accepted).toBeTrue();
    expect(result.executions).toBe(1);
    expect(result.observed.map((chunk) => chunk.type)).toContain("tool-result");
  });
});
