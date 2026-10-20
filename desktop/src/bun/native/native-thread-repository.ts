import type { MastraDBMessage } from "@mastra/core/agent";
import type { StorageThreadType } from "@mastra/core/memory";
import type { Memory } from "@mastra/memory";
import { THREAD_PIN_METADATA_KEY } from "../runtime/constants";

/** A pin write bumps updatedAt; a thread whose updatedAt is still inside this window of that write has had no real activity since. */
const PIN_BUMP_WINDOW_MS = 2000;

type PinRecord = { pinnedAt?: string | null; restoreUpdatedAt?: string; writtenAt?: string };

/**
 * Pinning and unpinning must not change where an unpinned thread sorts, but the store sets updatedAt on every write.
 * The pin record keeps the pre-write updatedAt, and a thread that has seen nothing since the pin write reports it.
 */
function withOriginalRecency(thread: StorageThreadType): StorageThreadType {
  const record = thread.metadata?.[THREAD_PIN_METADATA_KEY] as PinRecord | null | undefined;
  if (!record || typeof record !== "object" || !record.restoreUpdatedAt || !record.writtenAt) return thread;
  const written = Date.parse(record.writtenAt);
  const restore = new Date(record.restoreUpdatedAt);
  if (Number.isNaN(written) || Number.isNaN(restore.getTime())) return thread;
  return thread.updatedAt.getTime() <= written + PIN_BUMP_WINDOW_MS ? { ...thread, updatedAt: restore } : thread;
}

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
    return result.threads.map(withOriginalRecency).sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }

  async get(threadId: string): Promise<StorageThreadType | null> {
    const thread = await this.memory.getThreadById({ threadId, resourceId: this.resourceId });
    return thread ? withOriginalRecency(thread) : null;
  }

  create(title = "New chat", metadata: Record<string, unknown> = {}): Promise<StorageThreadType> {
    return this.memory.createThread({ resourceId: this.resourceId, title, metadata, saveThread: true });
  }

  async recall(threadId: string): Promise<MastraDBMessage[]> {
    const result = await this.memory.recall({ threadId, perPage: false });
    return result.messages;
  }

  async rename(threadId: string, title: string): Promise<StorageThreadType> {
    if (!(await this.get(threadId))) throw new Error("Conversation not found");
    // Title only: the store merges metadata shallowly, so no metadata is read back and rewritten here.
    return this.memory.updateThread({ id: threadId, title, metadata: {} });
  }

  /**
   * Pin metadata lives beside the title and the UI state, under its own key, so UI-state saves keep it.
   * Only that key is written (the store merges metadata shallowly), so a concurrent UI-state save is never reverted.
   */
  async setPinned(threadId: string, pinnedAt: string | null): Promise<StorageThreadType> {
    const thread = await this.get(threadId);
    if (!thread) throw new Error("Conversation not found");
    const record: PinRecord = { pinnedAt, restoreUpdatedAt: thread.updatedAt.toISOString(), writtenAt: new Date().toISOString() };
    // Unpinning writes an explicit null pinnedAt rather than omitting the key, because a merge cannot remove a key.
    return withOriginalRecency(await this.memory.updateThread({ id: threadId, metadata: { [THREAD_PIN_METADATA_KEY]: record } }));
  }

  delete(threadId: string): Promise<void> {
    return this.memory.deleteThread(threadId);
  }
}
