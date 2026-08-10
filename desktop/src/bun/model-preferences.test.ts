import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProteusStorage } from "./mastra-foundation";
import { parseAppModelSelection, resolveRememberedModelSelection } from "./model-preferences";

describe("conversation model defaults", () => {
  test("remembers provider, model, and reasoning across app storage restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proteus-model-preferences-"));
    const selected = {
      providerId: "codex" as const,
      modelId: "codex/gpt-5.6-sol" as const,
      reasoningEffort: "high" as const,
    };

    try {
      const first = createProteusStorage(directory);
      await first.appStorage.init();
      await first.modelPreferences.save(selected);
      await first.appStorage.close();

      const restarted = createProteusStorage(directory);
      try {
        await restarted.appStorage.init();
        expect(await restarted.modelPreferences.load()).toEqual(selected);
      } finally {
        await restarted.appStorage.close();
      }
    } finally {
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        // libSQL can retain the second same-process Windows test handle until
        // Bun exits. A real app restart uses a new process and releases it.
        if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
      }
    }
  });

  test("rejects a model that does not belong to its provider", () => {
    expect(parseAppModelSelection({ providerId: "codex", modelId: "openrouter/auto" })).toBeNull();
  });

  test("keeps a conversation selection authoritative over the new-chat default", () => {
    expect(resolveRememberedModelSelection(
      { providerId: "openrouter", modelId: "openrouter/auto" },
      { providerId: "codex", modelId: "codex/gpt-5.6-sol", reasoningEffort: "high" },
      { providerId: "openrouter", modelId: "openrouter/auto" },
    )).toEqual({ providerId: "openrouter", modelId: "openrouter/auto" });
  });

  test("uses the app preference as the default when a conversation has no selection", () => {
    expect(resolveRememberedModelSelection(
      null,
      { providerId: "codex", modelId: "codex/gpt-5.6-sol", reasoningEffort: "medium" },
      { providerId: "openrouter", modelId: "openrouter/auto" },
    )).toEqual({ providerId: "codex", modelId: "codex/gpt-5.6-sol", reasoningEffort: "medium" });
  });
});
