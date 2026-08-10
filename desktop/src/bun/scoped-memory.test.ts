import { describe, expect, test } from "bun:test";
import { createProteusStorage } from "./mastra-foundation";
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
    const foundation = createProteusStorage(".", { inMemory: true });
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
    const foundation = createProteusStorage(".", { inMemory: true });
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
    const foundation = createProteusStorage(".", { inMemory: true });
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
});
