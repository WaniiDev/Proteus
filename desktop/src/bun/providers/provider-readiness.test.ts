import { describe, expect, it } from "bun:test";
import { selectedModelMissingFromCatalog } from "./provider-readiness";

const openRouterModels = [{ id: "openrouter/auto" as const, providerId: "openrouter" as const, rawId: "auto", name: "Auto Router", inputModalities: ["text"], outputModalities: ["text"] }];

describe("provider-specific model readiness", () => {
  it("does not reject a Codex selection against the OpenRouter catalog", () => {
    expect(selectedModelMissingFromCatalog("codex", "codex/gpt-5.3-codex-spark[xhigh]", "openrouter", openRouterModels)).toBe(false);
  });

  it("still rejects a missing model from the selected provider's own catalog", () => {
    expect(selectedModelMissingFromCatalog("openrouter", "openrouter/missing", "openrouter", openRouterModels)).toBe(true);
  });
});
