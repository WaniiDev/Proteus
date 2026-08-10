import type { NativeAgentChunk, NativeStreamProjection } from "./native-stream-projection";
import { NativeStreamProjector } from "./native-stream-projection";
import type { RequestContext } from "@mastra/core/request-context";

type NativeThreadSubscription = {
  stream: AsyncIterable<NativeAgentChunk>;
  activeRunId: () => string | null;
  abort: () => boolean;
  unsubscribe: () => void;
};

type NativeQueueAccepted =
  | { action: "wake"; runId: string; output: { consumeStream: () => Promise<unknown> } }
  | { action: "deliver"; runId: string }
  | { action: "blocked"; runId: string; reason: string }
  | { action: "persist" }
  | { action: "discard" };

export type NativeQueueAgent = {
  subscribeToThread(options: { resourceId: string; threadId: string }): Promise<NativeThreadSubscription>;
  queueMessage(
    message: { contents: string; metadata?: Record<string, unknown> },
    options: { resourceId: string; threadId: string; ifIdle?: { streamOptions?: { requestContext?: RequestContext<any> } } },
  ): { accepted: Promise<NativeQueueAccepted> };
  sendStreamResume(options: { resourceId: string; threadId: string; runId: string; toolCallId?: string; resumeData: unknown; streamOptions?: { activeTools?: string[]; requestContext?: RequestContext<any> } }): Promise<{ accepted: true; runId: string; toolCallId?: string }>;
  listSuspendedRuns?(options: { resourceId: string; threadId: string }): Promise<{
    runs: Array<{ runId: string; toolCalls: Array<{ toolCallId?: string; toolName?: string; args?: unknown; requiresApproval: boolean; suspendPayload?: unknown }> }>;
  }>;
  sendToolApproval?(options: { resourceId: string; threadId: string; runId: string; toolCallId?: string; approved: boolean; requestContext: RequestContext<any> }): Promise<{ accepted: true; runId: string; toolCallId?: string }>;
};

export type NativeAgentDriverCallbacks = {
  onProjection: (projection: NativeStreamProjection, chunk: NativeAgentChunk) => void;
  onQueueChanged?: (threadId: string, count: number) => void;
  onError?: (error: unknown, threadId: string) => void;
};

/** Thin lifecycle bridge over Mastra's native thread subscription and queue. */
export class NativeAgentDriver {
  private readonly subscriptions = new Map<string, NativeThreadSubscription>();
  private readonly queuedCounts = new Map<string, number>();
  private readonly projector = new NativeStreamProjector();

  constructor(
    private readonly agent: NativeQueueAgent,
    private readonly resourceId: string,
    private readonly callbacks: NativeAgentDriverCallbacks,
  ) {}

  async queue(threadId: string, text: string, metadata?: Record<string, unknown>, requestContext?: RequestContext<any>): Promise<{ runId: string; queued: boolean }> {
    await this.ensureSubscription(threadId);
    const result = this.agent.queueMessage({ contents: text, ...(metadata ? { metadata } : {}) }, { resourceId: this.resourceId, threadId, ...(requestContext ? { ifIdle: { streamOptions: { requestContext } } } : {}) });
    const accepted = await result.accepted;
    if (accepted.action === "blocked") throw new Error("This conversation is waiting for a suspended tool response.");
    if (accepted.action === "persist" || accepted.action === "discard") throw new Error("Mastra accepted the message without starting or queueing a run.");
    const queued = accepted.action === "deliver";
    if (queued) this.setQueuedCount(threadId, this.queuedCount(threadId) + 1);
    if (accepted.action === "wake") void accepted.output.consumeStream().catch((error) => this.callbacks.onError?.(error, threadId));
    return { runId: accepted.runId, queued };
  }

  async ensureSubscription(threadId: string): Promise<NativeThreadSubscription> {
    const existing = this.subscriptions.get(threadId);
    if (existing) return existing;
    const subscription = await this.agent.subscribeToThread({ resourceId: this.resourceId, threadId });
    this.subscriptions.set(threadId, subscription);
    void this.consume(threadId, subscription);
    return subscription;
  }

  abort(threadId: string): boolean {
    return this.subscriptions.get(threadId)?.abort() ?? false;
  }

  async resume(threadId: string, runId: string, toolCallId: string, resumeData: unknown, streamOptions?: { activeTools?: string[]; requestContext?: RequestContext<any> }): Promise<{ runId: string }> {
    await this.ensureSubscription(threadId);
    const result = await this.agent.sendStreamResume({ resourceId: this.resourceId, threadId, runId, toolCallId, resumeData, ...(streamOptions ? { streamOptions } : {}) });
    if (!result.accepted) throw new Error("Mastra did not accept the stream resume request.");
    return { runId: result.runId };
  }

  async listSuspensions(threadId: string) {
    if (!this.agent.listSuspendedRuns) return [];
    const { runs } = await this.agent.listSuspendedRuns({ resourceId: this.resourceId, threadId });
    return runs.flatMap((run) => run.toolCalls.map((toolCall) => ({ ...toolCall, runId: run.runId })));
  }

  async findSuspension(threadId: string, toolCallId: string): Promise<{ runId: string; toolCallId: string; toolName?: string; args?: unknown; requiresApproval: boolean; suspendPayload?: unknown } | null> {
    if (!this.agent.listSuspendedRuns) return null;
    const { runs } = await this.agent.listSuspendedRuns({ resourceId: this.resourceId, threadId });
    for (const run of runs) {
      const toolCall = run.toolCalls.find((item) => item.toolCallId === toolCallId);
      if (toolCall) return { ...toolCall, toolCallId, runId: run.runId };
    }
    return null;
  }

  async approve(threadId: string, runId: string, toolCallId: string, approved: boolean, requestContext: RequestContext<any>): Promise<{ runId: string }> {
    await this.ensureSubscription(threadId);
    if (!this.agent.sendToolApproval) throw new Error("This agent does not support native tool approval.");
    const result = await this.agent.sendToolApproval({ resourceId: this.resourceId, threadId, runId, toolCallId, approved, requestContext });
    return { runId: result.runId };
  }

  queuedCount(threadId: string): number {
    return this.queuedCounts.get(threadId) ?? 0;
  }

  dispose(threadId?: string): void {
    const entries = threadId ? [[threadId, this.subscriptions.get(threadId)] as const] : [...this.subscriptions.entries()];
    for (const [id, subscription] of entries) {
      subscription?.unsubscribe();
      this.subscriptions.delete(id);
      this.queuedCounts.delete(id);
    }
  }

  private async consume(threadId: string, subscription: NativeThreadSubscription): Promise<void> {
    try {
      for await (const chunk of subscription.stream) {
        if (chunk.type === "start" && this.queuedCount(threadId) > 0) this.setQueuedCount(threadId, this.queuedCount(threadId) - 1);
        const projection = this.projector.apply(threadId, chunk);
        if (projection) this.callbacks.onProjection(projection, chunk);
        if (projection?.terminal) this.projector.delete(projection.runId);
      }
    } catch (error) {
      this.callbacks.onError?.(error, threadId);
    } finally {
      if (this.subscriptions.get(threadId) === subscription) this.subscriptions.delete(threadId);
    }
  }

  private setQueuedCount(threadId: string, count: number): void {
    const normalized = Math.max(0, count);
    this.queuedCounts.set(threadId, normalized);
    this.callbacks.onQueueChanged?.(threadId, normalized);
  }
}
