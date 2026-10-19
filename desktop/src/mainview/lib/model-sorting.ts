import type { ProviderModel, ProviderModelId } from "../../shared/contracts";

export const MODEL_SORT_OPTIONS = ["recommended", "recent", "popular", "newest", "alphabetical"] as const;
export type ModelSort = typeof MODEL_SORT_OPTIONS[number];

function compareOptionalNumber(left: number | undefined, right: number | undefined): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return left - right;
}

function compareOptionalDate(left: string | undefined, right: string | undefined): number {
  if (!left) return right ? 1 : 0;
  if (!right) return -1;
  return right.localeCompare(left);
}

function fallback(left: ProviderModel, right: ProviderModel): number {
  return compareOptionalNumber(left.popularityRank, right.popularityRank)
    || compareOptionalDate(left.createdAt, right.createdAt);
}

export function sortProviderModels(
  models: readonly ProviderModel[],
  sort: ModelSort,
  selectedModelId?: ProviderModelId,
): ProviderModel[] {
  const providerOrder = new Map(models.map((model, index) => [model.id, index]));
  return [...models].sort((left, right) => {
    if (sort === "recommended" && selectedModelId) {
      const selectedOrder = Number(right.id === selectedModelId) - Number(left.id === selectedModelId);
      if (selectedOrder) return selectedOrder;
    }
    if (sort === "recommended" || sort === "recent") {
      const recentOrder = compareOptionalDate(left.lastUsedAt, right.lastUsedAt);
      if (recentOrder) return recentOrder;
    }
    if (sort === "popular") {
      const popularOrder = compareOptionalNumber(left.popularityRank, right.popularityRank);
      if (popularOrder) return popularOrder;
    }
    if (sort === "newest") {
      const newestOrder = compareOptionalDate(left.createdAt, right.createdAt);
      if (newestOrder) return newestOrder;
    }
    if (sort === "alphabetical") return left.name.localeCompare(right.name);
    return fallback(left, right) || (providerOrder.get(left.id) ?? 0) - (providerOrder.get(right.id) ?? 0);
  });
}

export function modelSortLabel(sort: ModelSort): string {
  return {
    recommended: "Recommended",
    recent: "Recently used",
    popular: "Popular this week",
    newest: "Newest",
    alphabetical: "A–Z",
  }[sort];
}
