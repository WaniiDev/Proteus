import { join } from "node:path";
import { MastraCompositeStore } from "@mastra/core/storage";
import { LibSQLStore } from "@mastra/libsql";

export const PROTEUS_RUNTIME_VERSION = "v3" as const;

export type ProteusStorageFoundation = {
  storage: MastraCompositeStore;
  primary: LibSQLStore;
  paths: {
    primary: string;
  };
};

/**
 * Quickstart-style durable storage for Mastra's native application domains.
 */
export function createProteusStorage(userDataPath: string, options: { inMemory?: boolean } = {}): ProteusStorageFoundation {
  const paths = {
    primary: join(userDataPath, `proteus-${PROTEUS_RUNTIME_VERSION}.db`),
  };
  const primary = new LibSQLStore({
    id: `proteus-primary-${PROTEUS_RUNTIME_VERSION}`,
    url: options.inMemory ? ":memory:" : `file:${paths.primary}`,
  });
  const storage = new MastraCompositeStore({
    id: `proteus-storage-${PROTEUS_RUNTIME_VERSION}`,
    default: primary,
    domains: { observability: false },
  });
  return { storage, primary, paths };
}
