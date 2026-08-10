import { describe, expect, test } from "bun:test";
import { RequestContext } from "@mastra/core/request-context";
import { createProteusStorage } from "./mastra-foundation";
import { createMemoryTools } from "./memory-tools";
import { ScopedMemoryManager } from "./scoped-memory";

describe("memory tools", () => {
  test("uses request context to constrain current-project writes", async () => {
    const foundation = createProteusStorage(".", { inMemory: true });
    try {
      await foundation.appStorage.init();
      const manager = new ScopedMemoryManager(foundation.storage, foundation.memorySettings);
      const tools = createMemoryTools(manager);
      const requestContext = new RequestContext([
        ["proteus-project-id", "p1"],
        ["proteus-project-label", "Proteus"],
      ]);
      const result = await tools.remember.execute?.(
        { scope: "current_project", category: "decision", content: "Preserve the Orb." },
        { requestContext } as never,
      );
      expect(result).toMatchObject({ ok: true, entry: { content: "Preserve the Orb." } });
      expect((await manager.getState([], { kind: "project", projectId: "p1" })).scopes[1]?.entries).toHaveLength(1);
    } finally {
      await foundation.appStorage.close();
    }
  });

  test("requires native Mastra approval before forgetting", async () => {
    const foundation = createProteusStorage(".", { inMemory: true });
    try {
      await foundation.appStorage.init();
      const tools = createMemoryTools(new ScopedMemoryManager(foundation.storage, foundation.memorySettings));
      expect(tools.forget_memory.requireApproval).toBe(true);
    } finally {
      await foundation.appStorage.close();
    }
  });
});
