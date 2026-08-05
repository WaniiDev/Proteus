import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { createProteusStorage, PROTEUS_RUNTIME_VERSION } from "./mastra-foundation";

describe("Quickstart-native Mastra foundation", () => {
  test("uses a fresh native LibSQL database without an observability backend", async () => {
    const foundation = createProteusStorage(tmpdir(), { inMemory: true });

    try {
      expect(foundation.paths.primary).toEndWith(`proteus-${PROTEUS_RUNTIME_VERSION}.db`);
      expect(await foundation.storage.getStore("memory")).toBe(await foundation.primary.getStore("memory"));
      expect(await foundation.storage.getStore("observability")).toBeUndefined();
    } finally {
      await foundation.primary.close();
    }
  });
});
