import type { NativeAgentChunk, NativeStreamProjection } from "./native-stream-projection";
import { NativeStreamProjector } from "./native-stream-projection";

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
    options: { resourceId: string; threadId: string },
  ): { accepted: Promise<NativeQueueAccepted> };
  sendStreamResume(options: { resourceId: string; threadId: string; runId: string; toolCallId?: string; resumeData: unknown }): Promise<{ accepted: true; runId: string; toolCallId?: string }>;
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

  async queue(threadId: string, text: string, metadata?: Record<string, unknown>): Promise<{ runId: string; queued: boolean }> {
    const subscription = await this.ensureSubscription(threadId);
    const queued = subscription.activeRunId() !== null;
    const result = this.agent.queueMessage({ contents: text, ...(metadata ? { metadata } : {}) }, { resourceId: this.resourceId, threadId });
    const accepted = await result.accepted;
    if (accepted.action === "blocked") throw new Error("This conversation is waiting for a suspended tool response.");
    if (accepted.action === "persist" || accepted.action === "discard") throw new Error("Mastra accepted the message without starting or queueing a run.");
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

  async resume(threadId: string, runId: string, toolCallId: string, resumeData: unknown): Promise<{ runId: string }> {
    await this.ensureSubscription(threadId);
    const result = await this.agent.sendStreamResume({ resourceId: this.resourceId, threadId, runId, toolCallId, resumeData });
    if (!result.accepted) throw new Error("Mastra did not accept the stream resume request.");
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
