import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { refreshOpenAICodexToken } from "@mastra/code-sdk/auth/providers/openai-codex";
import type { CredentialStore, OAuthCredential, OAuthCredentials } from "@mastra/code-sdk/auth/types";
import { Utils } from "electrobun/bun";

const SERVICE = "com.proteus.companion";
const OPENROUTER_ACCOUNT = "openrouter.api-key";
const LEGACY_OPENROUTER_ACCOUNT = "openrouter";
const CODEX_ACCOUNT = "openai-codex.oauth";
const CODEX_PROVIDER = "openai-codex";
const NATIVE_FILE = "keyring.win32-x64-msvc.node";
const REFRESH_SKEW_MS = 60_000;

type NativeEntry = {
  new (service: string, username: string): {
    getPassword: () => string | null;
    setPassword: (password: string) => void;
    deletePassword: () => boolean;
  };
};

type NativeKeyring = { Entry: NativeEntry };

export interface NamedSecretStore {
  get(account: string): string | null;
  set(account: string, value: string): void;
  delete(account: string): void;
}

export class SecureStoreUnavailableError extends Error {
  constructor() {
    super("Windows Credential Manager is unavailable");
    this.name = "SecureStoreUnavailableError";
  }
}

function nativeCandidates(): string[] {
  return [
    join(import.meta.dir, NATIVE_FILE),
    join(process.cwd(), "node_modules", "@napi-rs", "keyring-win32-x64-msvc", NATIVE_FILE),
  ];
}

function loadNativeKeyring(): NativeKeyring {
  if (process.platform !== "win32" || process.arch !== "x64") throw new SecureStoreUnavailableError();

  for (const candidate of nativeCandidates()) {
    try {
      return import.meta.require(candidate) as NativeKeyring;
    } catch {
      // Try the next known location. No plaintext fallback is permitted.
    }
  }

  throw new SecureStoreUnavailableError();
}

let nativeKeyring: NativeKeyring | undefined;
const nativeEntries = new Map<string, InstanceType<NativeEntry>>();

function nativeEntry(account: string): InstanceType<NativeEntry> {
  const cached = nativeEntries.get(account);
  if (cached) return cached;
  nativeKeyring ??= loadNativeKeyring();
  const entry = new nativeKeyring.Entry(SERVICE, account);
  nativeEntries.set(account, entry);
  return entry;
}

export function createNativeSecretStore(): NamedSecretStore {
  const protect = <T>(operation: () => T): T => {
    try {
      return operation();
    } catch (error) {
      if (error instanceof SecureStoreUnavailableError) throw error;
      throw new SecureStoreUnavailableError();
    }
  };
  return {
    get: (account) => protect(() => nativeEntry(account).getPassword() || null),
    set: (account, value) => protect(() => nativeEntry(account).setPassword(value)),
    delete: (account) => protect(() => void nativeEntry(account).deletePassword()),
  };
}

export interface CredentialVault {
  get(): Promise<string | null>;
  set(apiKey: string): Promise<void>;
  delete(): Promise<void>;
}

export function createCredentialVault(secretStore: NamedSecretStore = createNativeSecretStore()): CredentialVault {
  return {
    async get() {
      const current = secretStore.get(OPENROUTER_ACCOUNT);
      if (current) return current;
      const legacy = secretStore.get(LEGACY_OPENROUTER_ACCOUNT);
      if (!legacy) return null;
      secretStore.set(OPENROUTER_ACCOUNT, legacy);
      secretStore.delete(LEGACY_OPENROUTER_ACCOUNT);
      return legacy;
    },
    async set(apiKey) {
      if (!apiKey.trim()) throw new Error("OpenRouter API key cannot be empty");
      secretStore.set(OPENROUTER_ACCOUNT, apiKey);
    },
    async delete() {
      secretStore.delete(OPENROUTER_ACCOUNT);
      secretStore.delete(LEGACY_OPENROUTER_ACCOUNT);
    },
  };
}

function parseOAuthCredential(value: string | null): OAuthCredential | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<OAuthCredential>;
    if (parsed.type !== "oauth" || typeof parsed.access !== "string" || !parsed.access || typeof parsed.refresh !== "string" || !parsed.refresh || typeof parsed.expires !== "number") return undefined;
    return parsed as OAuthCredential;
  } catch {
    return undefined;
  }
}

export interface CodexCredentialStore extends CredentialStore {
  setOAuth(credentials: OAuthCredentials): void;
  clear(): void;
}

export function createCodexCredentialStore(
  secretStore: NamedSecretStore = createNativeSecretStore(),
  refresh: typeof refreshOpenAICodexToken = refreshOpenAICodexToken,
): CodexCredentialStore {
  let credential = parseOAuthCredential(secretStore.get(CODEX_ACCOUNT));
  let refreshInFlight: Promise<string | undefined> | undefined;
  const persist = (next: OAuthCredential) => {
    credential = next;
    secretStore.set(CODEX_ACCOUNT, JSON.stringify(next));
  };
  return {
    allowEnvironmentFallback: false,
    reload() {
      credential = parseOAuthCredential(secretStore.get(CODEX_ACCOUNT));
    },
    get(provider) {
      return provider === CODEX_PROVIDER ? credential : undefined;
    },
    getStoredApiKey() {
      return undefined;
    },
    async getApiKey(provider) {
      if (provider !== CODEX_PROVIDER || !credential) return undefined;
      if (credential.expires > Date.now() + REFRESH_SKEW_MS) return credential.access;
      refreshInFlight ??= (async () => {
        const current = credential;
        if (!current) return undefined;
        const refreshed = await refresh(current.refresh, typeof current.accountId === "string" ? current.accountId : undefined);
        persist({ type: "oauth", ...refreshed });
        return refreshed.access;
      })().finally(() => {
        refreshInFlight = undefined;
      });
      return refreshInFlight;
    },
    setOAuth(credentials) {
      persist({ type: "oauth", ...credentials });
    },
    clear() {
      credential = undefined;
      secretStore.delete(CODEX_ACCOUNT);
    },
  };
}

export async function ensureUserDataDirectory(): Promise<string> {
  const userData = Utils.paths.userData;
  await mkdir(userData, { recursive: true });
  return userData;
}
