import type { MastraDBMessage } from "@mastra/core/agent";
import type { StorageThreadType } from "@mastra/core/memory";
import type { Memory } from "@mastra/memory";
import { THREAD_PIN_METADATA_KEY } from "../runtime/constants";

export class NativeThreadRepository {
  constructor(
    private readonly memory: Memory,
    private readonly resourceId: string,
  ) {}

  async list(): Promise<StorageThreadType[]> {
    const result = await this.memory.listThreads({
      filter: { resourceId: this.resourceId },
      perPage: false,
      orderBy: { field: "updatedAt", direction: "DESC" },
    });
    return result.threads;
  }

  get(threadId: string): Promise<StorageThreadType | null> {
    return this.memory.getThreadById({ threadId, resourceId: this.resourceId });
  }

  create(title = "New chat", metadata: Record<string, unknown> = {}): Promise<StorageThreadType> {
    return this.memory.createThread({ resourceId: this.resourceId, title, metadata, saveThread: true });
  }

  async recall(threadId: string): Promise<MastraDBMessage[]> {
    const result = await this.memory.recall({ threadId, perPage: false });
    return result.messages;
  }

  async rename(threadId: string, title: string): Promise<StorageThreadType> {
    const thread = await this.get(threadId);
    if (!thread) throw new Error("Conversation not found");
    return this.memory.updateThread({ id: threadId, title, metadata: thread.metadata ?? {} });
  }

  /** Pin metadata lives beside the title and the UI state, under its own key, so UI-state saves keep it. */
  async setPinned(threadId: string, pinnedAt: string | null): Promise<StorageThreadType> {
    const thread = await this.get(threadId);
    if (!thread) throw new Error("Conversation not found");
    // updateThread merges metadata, so unpinning writes an explicit null rather than omitting the key.
    return this.memory.updateThread({
      id: threadId,
      title: thread.title ?? "New chat",
      metadata: { ...(thread.metadata ?? {}), [THREAD_PIN_METADATA_KEY]: pinnedAt ? { pinnedAt } : null },
    });
  }

  delete(threadId: string): Promise<void> {
    return this.memory.deleteThread(threadId);
  }
}
