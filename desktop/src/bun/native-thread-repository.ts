import type { MastraDBMessage } from "@mastra/core/agent";
import type { StorageThreadType } from "@mastra/core/memory";
import type { Memory } from "@mastra/memory";

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

  create(title = "New chat"): Promise<StorageThreadType> {
    return this.memory.createThread({ resourceId: this.resourceId, title, saveThread: true });
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

  delete(threadId: string): Promise<void> {
    return this.memory.deleteThread(threadId);
  }
}
