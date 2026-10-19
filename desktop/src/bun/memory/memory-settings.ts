import { FactoryStorageDomain } from "@mastra/core/storage";

const SETTINGS_COLLECTION = "proteus_memory_settings";
const SCOPES_COLLECTION = "proteus_memory_scopes";
const SETTINGS_ID = "active";

export type StoredMemoryScope = {
  key: string;
  kind: "global" | "project";
  projectId?: string;
  label: string;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** Durable Proteus-owned preferences and scope index for Mastra Working Memory. */
export class MemorySettingsStorage extends FactoryStorageDomain {
  constructor() {
    super("proteus-memory-settings");
  }

  async init(): Promise<void> {
    await this.ensureCollections([
      {
        name: SETTINGS_COLLECTION,
        columns: {
          id: { type: "text", primaryKey: true },
          enabled: { type: "text" },
          updated_at: { type: "timestamp" },
        },
      },
      {
        name: SCOPES_COLLECTION,
        columns: {
          key: { type: "text", primaryKey: true },
          kind: { type: "text" },
          project_id: { type: "text", nullable: true },
          label: { type: "text" },
          archived: { type: "text" },
          created_at: { type: "timestamp" },
          updated_at: { type: "timestamp" },
        },
      },
    ]);
  }

  async loadEnabled(): Promise<boolean> {
    await this.ensureReady();
    const row = await this.ops.findOne<Record<string, unknown>>(SETTINGS_COLLECTION, { id: SETTINGS_ID });
    return row?.enabled === "1";
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.ensureReady();
    await this.ops.upsertOne(SETTINGS_COLLECTION, ["id"], {
      id: SETTINGS_ID,
      enabled: enabled ? "1" : "0",
      updated_at: new Date(),
    });
  }

  async listScopes(): Promise<StoredMemoryScope[]> {
    await this.ensureReady();
    const rows = await this.ops.findMany<Record<string, unknown>>(SCOPES_COLLECTION, {});
    return rows.map(mapStoredScope).sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "global" ? -1 : 1;
      return b.updatedAt.valueOf() - a.updatedAt.valueOf();
    });
  }

  async getScope(key: string): Promise<StoredMemoryScope | null> {
    await this.ensureReady();
    const row = await this.ops.findOne<Record<string, unknown>>(SCOPES_COLLECTION, { key });
    return row ? mapStoredScope(row) : null;
  }

  async saveScope(scope: StoredMemoryScope): Promise<void> {
    await this.ensureReady();
    await this.ops.upsertOne(SCOPES_COLLECTION, ["key"], {
      key: scope.key,
      kind: scope.kind,
      project_id: scope.projectId ?? null,
      label: scope.label,
      archived: scope.archived ? "1" : "0",
      created_at: scope.createdAt,
      updated_at: scope.updatedAt,
    });
  }

  async archiveProject(projectId: string): Promise<void> {
    await this.ensureReady();
    const scope = (await this.listScopes()).find((item) => item.kind === "project" && item.projectId === projectId);
    if (!scope || scope.archived) return;
    await this.saveScope({ ...scope, archived: true, updatedAt: new Date() });
  }

  async dangerouslyClearAll(): Promise<void> {
    await this.ensureReady();
    await this.ops.deleteMany(SETTINGS_COLLECTION, {});
    await this.ops.deleteMany(SCOPES_COLLECTION, {});
  }
}

function mapStoredScope(row: Record<string, unknown>): StoredMemoryScope {
  const kind = row.kind === "project" ? "project" : "global";
  return {
    key: String(row.key),
    kind,
    ...(kind === "project" && row.project_id ? { projectId: String(row.project_id) } : {}),
    label: String(row.label),
    archived: row.archived === "1",
    createdAt: new Date(row.created_at as string | number | Date),
    updatedAt: new Date(row.updated_at as string | number | Date),
  };
}
