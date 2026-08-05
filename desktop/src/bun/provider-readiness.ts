import type { ProviderId, ProviderModelId, RuntimeSnapshot } from "../shared/contracts";

export function selectedModelMissingFromCatalog(
  selectedProviderId: ProviderId,
  selectedModelId: ProviderModelId,
  catalogProviderId: ProviderId,
  models: RuntimeSnapshot["models"],
): boolean {
  return selectedProviderId === catalogProviderId && !models.some((model) => model.id === selectedModelId);
}
