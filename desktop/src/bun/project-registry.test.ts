import { describe, expect, test } from "bun:test";
import { createProteusStorage } from "./mastra-foundation";

describe("project registry", () => {
  test("persists and removes trusted project roots through Mastra storage", async () => {
    const foundation = createProteusStorage(".", { inMemory: true });
    const now = new Date("2026-08-06T00:00:00.000Z");
    try {
      await foundation.appStorage.init();
      await foundation.projects.save({ id: "project-1", name: "Proteus", rootPath: "C:\\Code\\Proteus", createdAt: now, updatedAt: now, lastOpenedAt: now });
      expect(await foundation.projects.list()).toEqual([{ id: "project-1", name: "Proteus", rootPath: "C:\\Code\\Proteus", createdAt: now, updatedAt: now, lastOpenedAt: now }]);
      await foundation.projects.remove("project-1");
      expect(await foundation.projects.list()).toEqual([]);
    } finally {
      await foundation.appStorage.close();
    }
  });
});
