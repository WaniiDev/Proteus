import { join } from "node:path";
import { MastraCompositeStore } from "@mastra/core/storage";
import { LibSQLFactoryStorage } from "@mastra/libsql";
import { ModelPreferencesStorage } from "./model-preferences";
import { MemorySettingsStorage } from "./memory-settings";
import { ProjectRegistryStorage } from "./project-registry";

export const Proteus_RUNTIME_VERSION = "v3" as const;

export type ProteusStorageFoundation = {
  storage: MastraCompositeStore;
  primary: MastraCompositeStore;
  appStorage: LibSQLFactoryStorage;
  modelPreferences: ModelPreferencesStorage;
  memorySettings: MemorySettingsStorage;
  projects: ProjectRegistryStorage;
  paths: {
    primary: string;
  };
};

/**
 * Quickstart-style durable storage for Mastra's native application domains.
 */
export function createProteusStorage(userDataPath: string, options: { inMemory?: boolean } = {}): ProteusStorageFoundation {
  const paths = {
    primary: join(userDataPath, `proteus-${Proteus_RUNTIME_VERSION}.db`),
  };
  const appStorage = new LibSQLFactoryStorage({
    id: `proteus-primary-${Proteus_RUNTIME_VERSION}`,
    url: options.inMemory ? ":memory:" : `file:${paths.primary}`,
  });
  const modelPreferences = appStorage.registerDomain(new ModelPreferencesStorage());
  const memorySettings = appStorage.registerDomain(new MemorySettingsStorage());
  const projects = appStorage.registerDomain(new ProjectRegistryStorage());
  const primary = appStorage.getMastraStorage();
  const storage = new MastraCompositeStore({
    id: `proteus-storage-${Proteus_RUNTIME_VERSION}`,
    default: primary,
    domains: { observability: false },
  });
  return { storage, primary, appStorage, modelPreferences, memorySettings, projects, paths };
}
