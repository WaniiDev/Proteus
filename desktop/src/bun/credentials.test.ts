import { describe, expect, it } from "bun:test";
import type { OAuthCredentials } from "@mastra/code-sdk/auth/types";
import { createCodexCredentialStore, createCredentialVault, type NamedSecretStore } from "./credentials";

function memorySecrets(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const store: NamedSecretStore = {
    get: (account) => values.get(account) ?? null,
    set: (account, value) => void values.set(account, value),
    delete: (account) => void values.delete(account),
  };
  return { store, values };
}

describe("secure provider credentials", () => {
  it("migrates the legacy OpenRouter account without exposing plaintext storage", async () => {
    const secrets = memorySecrets({ openrouter: "sk-or-legacy" });
    const vault = createCredentialVault(secrets.store);

    expect(await vault.get()).toBe("sk-or-legacy");
    expect(secrets.values.get("openrouter.api-key")).toBe("sk-or-legacy");
    expect(secrets.values.has("openrouter")).toBe(false);
  });

  it("stores ChatGPT OAuth in its named keyring account with environment fallback disabled", () => {
    const secrets = memorySecrets();
    const store = createCodexCredentialStore(secrets.store);
    store.setOAuth({ access: "access-token", refresh: "refresh-token", expires: Date.now() + 120_000, accountId: "account-1" });

    expect(store.allowEnvironmentFallback).toBe(false);
    expect(store.get("openai-codex")).toMatchObject({ type: "oauth", access: "access-token", accountId: "account-1" });
    expect(secrets.values.get("openai-codex.oauth")).toContain('"type":"oauth"');
    expect(store.get("openai")).toBeUndefined();
  });

  it("serializes concurrent refreshes and persists the upstream result once", async () => {
    const expired = JSON.stringify({ type: "oauth", access: "old", refresh: "refresh", expires: 0, accountId: "account-1" });
    const secrets = memorySecrets({ "openai-codex.oauth": expired });
    let refreshCalls = 0;
    let release!: (credentials: OAuthCredentials) => void;
    const refreshed = new Promise<OAuthCredentials>((resolve) => { release = resolve; });
    const store = createCodexCredentialStore(secrets.store, async () => {
      refreshCalls += 1;
      return refreshed;
    });

    const first = store.getApiKey("openai-codex");
    const second = store.getApiKey("openai-codex");
    release({ access: "new", refresh: "next", expires: Date.now() + 3_600_000, accountId: "account-1" });

    expect(await Promise.all([first, second])).toEqual(["new", "new"]);
    expect(refreshCalls).toBe(1);
    expect(secrets.values.get("openai-codex.oauth")).toContain('"access":"new"');
  });
});
