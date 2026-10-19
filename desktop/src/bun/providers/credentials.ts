import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { refreshOpenAICodexToken } from "@mastra/code-sdk/auth/providers/openai-codex";
import type { CredentialStore, OAuthCredential, OAuthCredentials } from "@mastra/code-sdk/auth/types";

const SERVICE = "com.proteus.companion";
const OPENROUTER_ACCOUNT = "openrouter.api-key";
const LEGACY_OPENROUTER_ACCOUNT = "openrouter";
const CODEX_ACCOUNT = "openai-codex.oauth";
const CODEX_CHUNK_PREFIX = `${CODEX_ACCOUNT}.chunk`;
const CODEX_PROVIDER = "openai-codex";
const NATIVE_FILE = "keyring.win32-x64-msvc.node";
const REFRESH_SKEW_MS = 60_000;
// Windows Credential Manager accepts at most 2,560 bytes per generic
// credential. The keyring binding stores strings as UTF-16, so leave ample
// room below its effective 1,280-character ceiling.
const SECRET_CHUNK_LENGTH = 1_000;
const MAX_SECRET_CHUNKS = 64;

type ChunkedSecretManifest = {
  kind: "proteus-keyring-chunks";
  version: 1;
  generation: string;
  chunks: number;
  length: number;
  sha256: string;
};

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

function chunkAccount(generation: string, index: number): string {
  return `${CODEX_CHUNK_PREFIX}.${generation}.${index}`;
}

function parseChunkedSecretManifest(value: string | null): ChunkedSecretManifest | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<ChunkedSecretManifest>;
    if (
      parsed.kind !== "proteus-keyring-chunks"
      || parsed.version !== 1
      || typeof parsed.generation !== "string"
      || !/^[0-9a-f-]{36}$/i.test(parsed.generation)
      || !Number.isInteger(parsed.chunks)
      || (parsed.chunks ?? 0) < 1
      || (parsed.chunks ?? 0) > MAX_SECRET_CHUNKS
      || !Number.isInteger(parsed.length)
      || (parsed.length ?? -1) < 0
      || typeof parsed.sha256 !== "string"
      || !/^[0-9a-f]{64}$/i.test(parsed.sha256)
    ) return undefined;
    return parsed as ChunkedSecretManifest;
  } catch {
    return undefined;
  }
}

function readCodexSecret(secretStore: NamedSecretStore): string | null {
  const root = secretStore.get(CODEX_ACCOUNT);
  const manifest = parseChunkedSecretManifest(root);
  // Credentials written before chunked storage remain readable and migrate on
  // the next successful OAuth login or token refresh.
  if (!manifest) return root;

  const chunks: string[] = [];
  for (let index = 0; index < manifest.chunks; index += 1) {
    const chunk = secretStore.get(chunkAccount(manifest.generation, index));
    if (chunk === null) return null;
    chunks.push(chunk);
  }
  const serialized = chunks.join("");
  if (serialized.length !== manifest.length) return null;
  if (createHash("sha256").update(serialized).digest("hex") !== manifest.sha256) return null;
  return serialized;
}

function deleteManifestChunks(secretStore: NamedSecretStore, manifest: ChunkedSecretManifest | undefined): void {
  if (!manifest) return;
  for (let index = 0; index < manifest.chunks; index += 1) {
    try {
      secretStore.delete(chunkAccount(manifest.generation, index));
    } catch {
      // The root manifest determines which generation is live. An orphaned old
      // chunk is unusable because no manifest can select it.
    }
  }
}

function writeCodexSecret(secretStore: NamedSecretStore, serialized: string): void {
  const previousManifest = parseChunkedSecretManifest(secretStore.get(CODEX_ACCOUNT));
  const chunks: string[] = [];
  for (let offset = 0; offset < serialized.length; offset += SECRET_CHUNK_LENGTH) chunks.push(serialized.slice(offset, offset + SECRET_CHUNK_LENGTH));
  if (chunks.length === 0) chunks.push("");
  if (chunks.length > MAX_SECRET_CHUNKS) throw new SecureStoreUnavailableError();

  const generation = randomUUID();
  const writtenAccounts: string[] = [];
  try {
    for (const [index, chunk] of chunks.entries()) {
      const account = chunkAccount(generation, index);
      secretStore.set(account, chunk);
      writtenAccounts.push(account);
    }
    const manifest: ChunkedSecretManifest = {
      kind: "proteus-keyring-chunks",
      version: 1,
      generation,
      chunks: chunks.length,
      length: serialized.length,
      sha256: createHash("sha256").update(serialized).digest("hex"),
    };
    // Commit the new generation only after every chunk is safely stored.
    secretStore.set(CODEX_ACCOUNT, JSON.stringify(manifest));
  } catch (error) {
    for (const account of writtenAccounts) {
      try {
        secretStore.delete(account);
      } catch {
        // Preserve the original storage failure.
      }
    }
    throw error;
  }

  deleteManifestChunks(secretStore, previousManifest);
}

function deleteCodexSecret(secretStore: NamedSecretStore): void {
  const manifest = parseChunkedSecretManifest(secretStore.get(CODEX_ACCOUNT));
  secretStore.delete(CODEX_ACCOUNT);
  deleteManifestChunks(secretStore, manifest);
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
  let credential = parseOAuthCredential(readCodexSecret(secretStore));
  let refreshInFlight: Promise<string | undefined> | undefined;
  const persist = (next: OAuthCredential) => {
    writeCodexSecret(secretStore, JSON.stringify(next));
    credential = next;
  };
  return {
    allowEnvironmentFallback: false,
    reload() {
      credential = parseOAuthCredential(readCodexSecret(secretStore));
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
      deleteCodexSecret(secretStore);
      credential = undefined;
    },
  };
}

export async function ensureUserDataDirectory(): Promise<string> {
  const { Utils } = await import("electrobun/bun");
  const userData = Utils.paths.userData;
  await mkdir(userData, { recursive: true });
  return userData;
}
