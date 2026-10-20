import type { ProviderId } from "../../shared/contracts";

export const PROVIDER_LOGOS: Record<ProviderId, string> = {
  openrouter: new URL("../assets/providers/openrouter.svg", import.meta.url).href,
  codex: new URL("../assets/providers/codex.svg", import.meta.url).href,
  anthropic: new URL("../assets/providers/anthropic.svg", import.meta.url).href,
};
