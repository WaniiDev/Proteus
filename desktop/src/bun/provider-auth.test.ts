import { describe, expect, it } from "bun:test";
import type { ProviderAuth, RuntimeSnapshot } from "../shared/contracts";
import { reconcileProviderAuth } from "./provider-auth";

const failed: ProviderAuth = {
  providerId: "codex",
  mode: "browser",
  status: "failed",
  error: "Authorization failed",
};

function providers(verified: boolean): RuntimeSnapshot["providers"] {
  return [{
    id: "codex",
    name: "Codex",
    configured: verified,
    verified,
    availability: verified ? "ready" : "needs-configuration",
  }];
}

describe("provider authentication state", () => {
  it("drops a stale OAuth failure once the provider is verified", () => {
    expect(reconcileProviderAuth(providers(true), failed)).toBeNull();
  });

  it("keeps a genuine failure while the provider is not verified", () => {
    expect(reconcileProviderAuth(providers(false), failed)).toEqual(failed);
  });

  it("keeps live authorization progress visible", () => {
    expect(reconcileProviderAuth(providers(true), { ...failed, status: "waiting" })).toMatchObject({ status: "waiting" });
  });
});
