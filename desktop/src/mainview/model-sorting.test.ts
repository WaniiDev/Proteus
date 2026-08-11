import { describe, expect, test } from "bun:test";
import type { ProviderModel } from "../shared/contracts";
import { sortProviderModels } from "./model-sorting";

function model(id: string, fields: Partial<ProviderModel> = {}): ProviderModel {
  return {
    id: `openrouter/${id}`,
    providerId: "openrouter",
    rawId: id,
    name: id,
    inputModalities: ["text"],
    outputModalities: ["text"],
    ...fields,
  };
}

describe("model catalog sorting", () => {
  const models = [
    model("older-popular", { popularityRank: 1, createdAt: "2025-01-01T00:00:00.000Z" }),
    model("newest", { popularityRank: 3, createdAt: "2026-01-01T00:00:00.000Z" }),
    model("recent", { popularityRank: 2, lastUsedAt: "2026-02-01T00:00:00.000Z" }),
  ];

  test("recommended pins the selection, then uses recency and popularity", () => {
    expect(sortProviderModels(models, "recommended", "openrouter/newest").map((item) => item.rawId))
      .toEqual(["newest", "recent", "older-popular"]);
  });

  test("supports explicit recent, popular, newest, and alphabetical orders", () => {
    expect(sortProviderModels(models, "recent").map((item) => item.rawId)).toEqual(["recent", "older-popular", "newest"]);
    expect(sortProviderModels(models, "popular").map((item) => item.rawId)).toEqual(["older-popular", "recent", "newest"]);
    expect(sortProviderModels(models, "newest").map((item) => item.rawId)).toEqual(["newest", "older-popular", "recent"]);
    expect(sortProviderModels(models, "alphabetical").map((item) => item.rawId)).toEqual(["newest", "older-popular", "recent"]);
  });
});
