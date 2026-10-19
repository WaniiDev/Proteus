import { describe, expect, test } from "bun:test";
import { createProteusStorage } from "../core/mastra-foundation";
import { MEMORY_CONTEXT_LIMIT, ScopedMemoryManager } from "./scoped-memory";

const PROJECT = {
  id: "project-1",
  name: "Proteus",
  rootPath: "C:\\Code\\Proteus",
  createdAt: new Date("2026-08-10T00:00:00.000Z"),
  updatedAt: new Date("2026-08-10T00:00:00.000Z"),
  lastOpenedAt: new Date("2026-08-10T00:00:00.000Z"),
};

describe("scoped Mastra Working Memory", () => {
  test("is opt-in and keeps global and project entries isolated", async () => {
    const foundation = createProteusStorage("..", { inMemory: true });
    try {
      await foundation.appStorage.init();
      const manager = new ScopedMemoryManager(foundation.storage, foundation.memorySettings);
      expect((await manager.getState([PROJECT])).enabled).toBe(false);

      await manager.setEnabled(true, [PROJECT]);
      const global = await manager.create({ kind: "global" }, "preference", "Use concise explanations.", "All conversations");
      const project = await manager.create({ kind: "project", projectId: PROJECT.id }, "decision", "Keep the Orb renderer.", PROJECT.name);

      const state = await manager.getState([PROJECT]);
      expect(state.enabled).toBe(true);
      expect(state.scopes.find((scope) => scope.key === "global")?.entries).toEqual([global]);
      expect(state.scopes.find((scope) => scope.key === `project:${PROJECT.id}`)?.entries).toEqual([project]);
      expect(await manager.contextFor()).toContain("Use concise explanations.");
      expect(await manager.contextFor()).not.toContain("Keep the Orb renderer.");
      expect(await manager.contextFor(PROJECT.id)).toContain("Keep the Orb renderer.");
    } finally {
      await foundation.appStorage.close();
    }
  });

  test("supports deterministic edit, delete, reset, and retained project archives", async () => {
    const foundation = createProteusStorage("..", { inMemory: true });
    try {
      await foundation.appStorage.init();
      const manager = new ScopedMemoryManager(foundation.storage, foundation.memorySettings);
      const scope = { kind: "project" as const, projectId: PROJECT.id };
      const entry = await manager.create(scope, "goal", "Ship the refactor.", PROJECT.name);
      await manager.update(scope, entry.id, "decision", "Ship the tested refactor.", PROJECT.name);
      expect((await manager.getState([PROJECT])).scopes[1]?.entries[0]?.content).toBe("Ship the tested refactor.");

      await manager.delete(scope, entry.id, PROJECT.name);
      expect((await manager.getState([PROJECT])).scopes[1]?.entries).toEqual([]);
      await manager.create(scope, "goal", "Retain this archive.", PROJECT.name);
      await manager.archiveProject(PROJECT.id);
      const archived = await manager.getState([]);
      expect(archived.scopes.find((item) => item.key === `project:${PROJECT.id}`)?.status).toBe("archived");
      expect(archived.scopes.find((item) => item.key === `project:${PROJECT.id}`)?.entries).toHaveLength(1);

      await manager.reset(scope, PROJECT.name);
      const reset = (await manager.getState([])).scopes.find((item) => item.key === `project:${PROJECT.id}`);
      expect(reset?.entries).toEqual([]);
      expect(reset?.status).toBe("archived");
    } finally {
      await foundation.appStorage.close();
    }
  });

  test("caps injected context and never injects while disabled", async () => {
    const foundation = createProteusStorage("..", { inMemory: true });
    try {
      await foundation.appStorage.init();
      const manager = new ScopedMemoryManager(foundation.storage, foundation.memorySettings);
      await manager.create({ kind: "global" }, "profile", "A".repeat(500), "All conversations");
      expect(await manager.contextFor()).toBe("");
      await manager.setEnabled(true, []);
      for (let index = 0; index < 14; index += 1) {
        await manager.create({ kind: "global" }, "preference", `${index}:${"B".repeat(490)}`, "All conversations");
      }
      const context = await manager.contextFor();
      expect(context.length).toBeLessThanOrEqual(MEMORY_CONTEXT_LIMIT);
      expect(context).toEndWith("[Memory truncated]");
    } finally {
      await foundation.appStorage.close();
    }
  });

  test("keeps valid entries and backs up the original when one entry is invalid", async () => {
    const foundation = createProteusStorage("..", { inMemory: true });
    try {
      await foundation.appStorage.init();
      const manager = new ScopedMemoryManager(foundation.storage, foundation.memorySettings);
      const kept = await manager.create({ kind: "global" }, "preference", "Keep me.", "All conversations");
      const memory = (manager as unknown as { memory: { getWorkingMemory(i: object): Promise<string>; updateWorkingMemory(i: object): Promise<void> } }).memory;
      const ids = { threadId: "proteus-memory:global", resourceId: "proteus-memory:global" };
      const damaged = JSON.stringify({ version: 1, entries: [kept, { id: "bad", category: "nope" }] });
      await memory.updateWorkingMemory({ ...ids, workingMemory: damaged });

      await manager.create({ kind: "global" }, "goal", "New one.", "All conversations");
      await manager.setEnabled(true, []);
      const contents = (await manager.getState([])).scopes[0]?.entries.map((e) => e.content).sort();
      expect(contents).toEqual(["Keep me.", "New one."]);
    } finally {
      await foundation.appStorage.close();
    }
  });

  test("an unreadable document is backed up before being overwritten", async () => {
    const foundation = createProteusStorage("..", { inMemory: true });
    try {
      await foundation.appStorage.init();
      const manager = new ScopedMemoryManager(foundation.storage, foundation.memorySettings);
      await manager.create({ kind: "global" }, "preference", "Old.", "All conversations");
      const memory = (manager as unknown as { memory: { getWorkingMemory(i: object): Promise<string | null>; updateWorkingMemory(i: object): Promise<void>; listThreads(a: object): Promise<{ threads: { id: string }[] }> } }).memory;
      const ids = { threadId: "proteus-memory:global", resourceId: "proteus-memory:global" };
      await memory.updateWorkingMemory({ ...ids, workingMemory: JSON.stringify({ version: 2, entries: [] }) });
      await manager.create({ kind: "global" }, "goal", "Fresh.", "All conversations");
      const backup = (await memory.listThreads({ filter: { resourceId: undefined } as never }).catch(() => ({ threads: [] }))).threads.find((t) => t.id.includes("corrupt"));
      expect(backup).toBeDefined();
      const raw = await memory.getWorkingMemory({ threadId: backup!.id, resourceId: backup!.id });
      expect(raw).toContain('"version":2');
    } finally {
      await foundation.appStorage.close();
    }
  });
});
