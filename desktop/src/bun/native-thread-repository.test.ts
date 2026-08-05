import { describe, expect, test } from "bun:test";
import { Memory } from "@mastra/memory";
import { createProteusStorage } from "./mastra-foundation";
import { NativeThreadRepository } from "./native-thread-repository";

describe("native Mastra thread repository", () => {
  test("creates, renames, lists, recalls, and permanently deletes owned threads", async () => {
    const foundation = createProteusStorage(".", { inMemory: true });
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
    const foundation = createProteusStorage(".", { inMemory: true });
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
});
