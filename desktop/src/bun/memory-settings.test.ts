import { describe, expect, test } from "bun:test";
import { createProteusStorage } from "./mastra-foundation";

describe("memory settings storage", () => {
  test("defaults off and persists scope archive metadata", async () => {
    const foundation = createProteusStorage(".", { inMemory: true });
    try {
      await foundation.appStorage.init();
      expect(await foundation.memorySettings.loadEnabled()).toBe(false);
      await foundation.memorySettings.setEnabled(true);
      const now = new Date("2026-08-10T00:00:00.000Z");
      await foundation.memorySettings.saveScope({
        key: "project:p1",
        kind: "project",
        projectId: "p1",
        label: "Proteus",
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      await foundation.memorySettings.archiveProject("p1");
      expect(await foundation.memorySettings.loadEnabled()).toBe(true);
      expect((await foundation.memorySettings.listScopes())[0]).toMatchObject({ key: "project:p1", archived: true });
    } finally {
      await foundation.appStorage.close();
    }
  });
});
