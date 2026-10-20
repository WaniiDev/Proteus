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

  /**
   * LibSQL's updateThread reads, merges and writes without a lock, so concurrent writers to one thread lose keys.
   * Every metadata or title write for a thread goes through this per-thread queue.
   */
  private readonly writeQueues = new Map<string, Promise<unknown>>();

  /** Run a thread's metadata read-merge-write exclusively; all writers (pin, rename, UI state) share this queue. */
  exclusive<T>(threadId: string, task: () => Promise<T>): Promise<T> {
    const run = (this.writeQueues.get(threadId) ?? Promise.resolve()).catch(() => undefined).then(task);
    const tracked = run.catch(() => undefined).finally(() => {
      if (this.writeQueues.get(threadId) === tracked) this.writeQueues.delete(threadId);
    });
    this.writeQueues.set(threadId, tracked);
    return run;
  }

  /**
   * Serialised partial write. `build` sees the stored thread and returns only the keys this writer owns
   * (the store merges metadata shallowly). Returns null when the thread does not exist.
   */
  updateMetadata(threadId: string, build: (thread: StorageThreadType) => { title?: string; metadata: Record<string, unknown> }): Promise<StorageThreadType | null> {
    return this.exclusive(threadId, async () => {
      const thread = await this.memory.getThreadById({ threadId, resourceId: this.resourceId });
      if (!thread) return null;
      const { title, metadata } = build(thread);
      return this.memory.updateThread({ id: threadId, ...(title === undefined ? {} : { title }), metadata });
    });
  }

  async rename(threadId: string, title: string): Promise<StorageThreadType> {
    // Title only: the store merges metadata shallowly, so no metadata is read back and rewritten here.
    const updated = await this.updateMetadata(threadId, () => ({ title, metadata: {} }));
    if (!updated) throw new Error("Conversation not found");
    return updated;
  }

  /**
   * Pin metadata lives beside the title and the UI state, under its own key, so UI-state saves keep it.
   * Only that key is written (the store merges metadata shallowly) and every writer is serialised per thread.
   */
  async setPinned(threadId: string, pinnedAt: string | null): Promise<StorageThreadType> {
    const updated = await this.updateMetadata(threadId, (thread) => {
      const current = withOriginalRecency(thread);
      // Unpinning writes an explicit null pinnedAt rather than omitting the key, because a merge cannot remove a key.
      const record: PinRecord = { pinnedAt, restoreUpdatedAt: current.updatedAt.toISOString(), writtenAt: new Date().toISOString() };
      return { metadata: { [THREAD_PIN_METADATA_KEY]: record } };
    });
    if (!updated) throw new Error("Conversation not found");
    return withOriginalRecency(updated);
  }

  delete(threadId: string): Promise<void> {
    return this.memory.deleteThread(threadId);
  }
}
