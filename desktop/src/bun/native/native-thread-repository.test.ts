import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { Memory } from "@mastra/memory";
import { createProteusStorage } from "../core/mastra-foundation";
import { mapThread } from "../runtime/message-mapping";
import { NativeThreadRepository } from "./native-thread-repository";

describe("native Mastra thread repository", () => {
  test("creates, renames, lists, recalls, and permanently deletes owned threads", async () => {
    const foundation = createProteusStorage("..", { inMemory: true });
    const memory = new Memory({ storage: foundation.storage, vector: false, options: { lastMessages: 20, semanticRecall: false } });
    const threads = new NativeThreadRepository(memory, "local-user");

    try {
      const created = await threads.create("First title");
      expect((await threads.list()).map((thread) => thread.id)).toContain(created.id);
      expect((await threads.rename(created.id, "Renamed")).title).toBe("Renamed");
      expect(await threads.recall(created.id)).toEqual([]);
      await threads.delete(created.id);
      expect(await threads.get(created.id)).toBeNull();
      expect((await threads.list()).map((thread) => thread.id)).not.toContain(created.id);
    } finally {
      await foundation.appStorage.close();
    }
  });

  test("never exposes another resource's threads", async () => {
    const foundation = createProteusStorage("..", { inMemory: true });
    const memory = new Memory({ storage: foundation.storage, vector: false });
    const local = new NativeThreadRepository(memory, "local-user");
    const other = new NativeThreadRepository(memory, "other-user");

    try {
      await local.create("Local");
      await other.create("Other");
      expect((await local.list()).map((thread) => thread.title)).toEqual(["Local"]);
    } finally {
      await foundation.appStorage.close();
    }
  });

  test("pin metadata survives a new storage instance and unpin clears it (WAN-513)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "proteus-pin-"));
    const open = () => {
      const foundation = createProteusStorage(dir);
      const memory = new Memory({ storage: foundation.storage, vector: false, options: { lastMessages: 20, semanticRecall: false } });
      return { foundation, threads: new NativeThreadRepository(memory, "local-user") };
    };
    let first = open();
    try {
      const created = await first.threads.create("Pin me", { keep: "yes" });
      await first.threads.setPinned(created.id, "2026-02-01T00:00:00.000Z");
      await first.threads.rename(created.id, "Renamed");
      await first.foundation.appStorage.close();

      first = open();
      const reloaded = mapThread((await first.threads.get(created.id))!);
      expect(reloaded.pinned).toBe(true);
      expect(reloaded.pinnedAt).toBe("2026-02-01T00:00:00.000Z");
      expect(reloaded.title).toBe("Renamed");
      expect((await first.threads.get(created.id))!.metadata?.keep).toBe("yes");

      await first.threads.setPinned(created.id, null);
      const unpinned = mapThread((await first.threads.get(created.id))!);
      expect(unpinned.pinned).toBe(false);
      expect(unpinned.pinnedAt).toBeNull();
    } finally {
      await first.foundation.appStorage.close().catch(() => undefined);
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("pin and a concurrent UI-state write each keep the other's metadata key (WAN-513)", async () => {
    const foundation = createProteusStorage("..", { inMemory: true });
    const memory = new Memory({ storage: foundation.storage, vector: false, options: { lastMessages: 20, semanticRecall: false } });
    const threads = new NativeThreadRepository(memory, "local-user");
    try {
      const store = (await foundation.storage.getStore("memory"))!;
      const created = await threads.create("Race", { "proteus.ui.v2": { workspaceBinding: { kind: "app" }, rev: 0 } });
      // The UI-state write is issued while the pin write is still reading, and again while it is writing.
      const uiWrite = (rev: number) => store.updateThread({ id: created.id, metadata: { "proteus.ui.v2": { workspaceBinding: { kind: "app" }, rev } } });
      await Promise.all([threads.setPinned(created.id, "2026-02-01T00:00:00.000Z"), uiWrite(1)]);
      await Promise.all([uiWrite(2), threads.setPinned(created.id, "2026-02-02T00:00:00.000Z"), uiWrite(3)]);
      const metadata = (await threads.get(created.id))!.metadata as Record<string, any>;
      expect(metadata["proteus.pin.v1"].pinnedAt).toBe("2026-02-02T00:00:00.000Z");
      expect(metadata["proteus.ui.v2"].rev).toBe(3);

      // A stale rename must not revert either key either.
      await Promise.all([threads.rename(created.id, "Renamed"), uiWrite(4), threads.setPinned(created.id, null)]);
      const after = (await threads.get(created.id))!;
      expect(after.title).toBe("Renamed");
      expect((after.metadata as Record<string, any>)["proteus.ui.v2"].rev).toBe(4);
      expect(mapThread(after).pinned).toBe(false);
    } finally {
      await foundation.appStorage.close();
    }
  });

  test("pinning then unpinning an older thread keeps its place among unpinned threads (WAN-513)", async () => {
    const foundation = createProteusStorage("..", { inMemory: true });
    const memory = new Memory({ storage: foundation.storage, vector: false, options: { lastMessages: 20, semanticRecall: false } });
    const threads = new NativeThreadRepository(memory, "local-user");
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    try {
      const older = await threads.create("Older");
      await sleep(15);
      const newer = await threads.create("Newer");
      await sleep(15);
      const originalUpdatedAt = (await threads.get(older.id))!.updatedAt.getTime();

      await threads.setPinned(older.id, new Date().toISOString());
      await threads.setPinned(older.id, null);

      const listed = await threads.list();
      expect(listed.map((thread) => thread.id)).toEqual([newer.id, older.id]);
      expect(listed[1]!.updatedAt.getTime()).toBe(originalUpdatedAt);
      expect((await threads.get(older.id))!.updatedAt.getTime()).toBe(originalUpdatedAt);
    } finally {
      await foundation.appStorage.close();
    }
  });
});
