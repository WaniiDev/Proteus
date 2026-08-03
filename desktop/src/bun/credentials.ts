import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Utils } from "electrobun/bun";

const SERVICE = "com.proteus.companion";
const ACCOUNT = "openrouter";
const NATIVE_FILE = "keyring.win32-x64-msvc.node";

type NativeEntry = {
  new (service: string, username: string): {
    getPassword: () => string | null;
    setPassword: (password: string) => void;
    deletePassword: () => boolean;
  };
};

type NativeKeyring = { Entry: NativeEntry };

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

let entry: InstanceType<NativeEntry> | undefined;

function getEntry(): InstanceType<NativeEntry> {
  if (entry) return entry;
  const native = loadNativeKeyring();
  entry = new native.Entry(SERVICE, ACCOUNT);
  return entry;
}

export interface CredentialVault {
  get(): Promise<string | null>;
  set(apiKey: string): Promise<void>;
  delete(): Promise<void>;
}

export function createCredentialVault(): CredentialVault {
  return {
    async get() {
      try {
        return getEntry().getPassword() || null;
      } catch (error) {
        if (error instanceof SecureStoreUnavailableError) throw error;
        throw new SecureStoreUnavailableError();
      }
    },
    async set(apiKey) {
      if (!apiKey.trim()) throw new Error("OpenRouter API key cannot be empty");
      try {
        getEntry().setPassword(apiKey);
      } catch (error) {
        if (error instanceof SecureStoreUnavailableError) throw error;
        throw new SecureStoreUnavailableError();
      }
    },
    async delete() {
      try {
        getEntry().deletePassword();
      } catch (error) {
        if (error instanceof SecureStoreUnavailableError) throw error;
        throw new SecureStoreUnavailableError();
      }
    },
  };
}

export async function ensureUserDataDirectory(): Promise<string> {
  const userData = Utils.paths.userData;
  await mkdir(userData, { recursive: true });
  return userData;
}
