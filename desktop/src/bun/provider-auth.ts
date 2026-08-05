import type { ProviderAuth, RuntimeSnapshot } from "../shared/contracts";

export function reconcileProviderAuth(
  providers: RuntimeSnapshot["providers"],
  providerAuth: ProviderAuth | null,
): ProviderAuth | null {
  if (!providerAuth || providerAuth.status !== "failed") return providerAuth;
  const provider = providers.find((candidate) => candidate.id === providerAuth.providerId);
  return provider?.verified ? null : providerAuth;
}
