import { describe, expect, it } from "bun:test";
import type { OAuthCredentials } from "@mastra/code-sdk/auth/types";
import { createCodexCredentialStore, createCredentialVault, type NamedSecretStore } from "./credentials";

function memorySecrets(initial: Record<string, string> = {}, maxValueLength = Number.POSITIVE_INFINITY) {
  const values = new Map(Object.entries(initial));
  const store: NamedSecretStore = {
    get: (account) => values.get(account) ?? null,
    set: (account, value) => {
      if (value.length > maxValueLength) throw new Error("credential exceeds platform limit");
      values.set(account, value);
    },
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

  it("stores ChatGPT OAuth as an atomic chunk manifest with environment fallback disabled", () => {
    const secrets = memorySecrets();
    const store = createCodexCredentialStore(secrets.store);
    store.setOAuth({ access: "access-token", refresh: "refresh-token", expires: Date.now() + 120_000, accountId: "account-1" });

    expect(store.allowEnvironmentFallback).toBe(false);
    expect(store.get("openai-codex")).toMatchObject({ type: "oauth", access: "access-token", accountId: "account-1" });
    expect(secrets.values.get("openai-codex.oauth")).toContain('"kind":"proteus-keyring-chunks"');
    expect(secrets.values.get("openai-codex.oauth")).not.toContain("access-token");
    expect(store.get("openai")).toBeUndefined();
  });

  it("round-trips OAuth credentials larger than the Windows per-entry limit", () => {
    const secrets = memorySecrets({}, 1_280);
    const store = createCodexCredentialStore(secrets.store);
    const access = `access-${"a".repeat(3_000)}`;
    const refresh = `refresh-${"r".repeat(1_500)}`;

    store.setOAuth({ access, refresh, expires: Date.now() + 120_000, accountId: "account-1" });

    expect([...secrets.values.values()].every((value) => value.length <= 1_280)).toBe(true);
    expect([...secrets.values.keys()].filter((account) => account.startsWith("openai-codex.oauth.chunk.")).length).toBeGreaterThan(1);
    const reloaded = createCodexCredentialStore(secrets.store);
    expect(reloaded.get("openai-codex")).toMatchObject({ access, refresh, accountId: "account-1" });
  });

  it("does not replace the in-memory credential when secure persistence fails", () => {
    const legacy = JSON.stringify({ type: "oauth", access: "old", refresh: "old-refresh", expires: Date.now() + 120_000, accountId: "account-1" });
    const secrets = memorySecrets({ "openai-codex.oauth": legacy }, 10);
    const store = createCodexCredentialStore(secrets.store);

    expect(() => store.setOAuth({ access: "new", refresh: "new-refresh", expires: Date.now() + 120_000, accountId: "account-1" })).toThrow();
    expect(store.get("openai-codex")).toMatchObject({ access: "old", refresh: "old-refresh" });
  });

  it("removes the manifest and all live credential chunks on disconnect", () => {
    const secrets = memorySecrets({}, 1_280);
    const store = createCodexCredentialStore(secrets.store);
    store.setOAuth({ access: "a".repeat(3_000), refresh: "r".repeat(1_500), expires: Date.now() + 120_000, accountId: "account-1" });

    store.clear();

    expect([...secrets.values.keys()].filter((account) => account.startsWith("openai-codex.oauth"))).toEqual([]);
    expect(store.get("openai-codex")).toBeUndefined();
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
    expect(createCodexCredentialStore(secrets.store).get("openai-codex")).toMatchObject({ access: "new", refresh: "next" });
  });
});
