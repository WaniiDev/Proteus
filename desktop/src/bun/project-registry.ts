import { FactoryStorageDomain } from "@mastra/core/storage";

const COLLECTION = "proteus_projects";

export type StoredProject = {
  id: string;
  name: string;
  rootPath: string;
  createdAt: Date;
  updatedAt: Date;
  lastOpenedAt: Date;
};

export class ProjectRegistryStorage extends FactoryStorageDomain {
  constructor() {
    super("proteus-project-registry");
  }

  async init(): Promise<void> {
    await this.ensureCollections([{ name: COLLECTION, columns: {
      id: { type: "text", primaryKey: true }, name: { type: "text" }, root_path: { type: "text" },
      created_at: { type: "timestamp" }, updated_at: { type: "timestamp" }, last_opened_at: { type: "timestamp" },
    } }]);
  }

  async list(): Promise<StoredProject[]> {
    await this.ensureReady();
    const rows = await this.ops.findMany<Record<string, unknown>>(COLLECTION, {});
    return rows.map((row) => ({
      id: String(row.id), name: String(row.name), rootPath: String(row.root_path),
      createdAt: new Date(row.created_at as string | number | Date),
      updatedAt: new Date(row.updated_at as string | number | Date),
      lastOpenedAt: new Date(row.last_opened_at as string | number | Date),
    })).sort((a, b) => b.lastOpenedAt.valueOf() - a.lastOpenedAt.valueOf());
  }

  async save(project: StoredProject): Promise<void> {
    await this.ensureReady();
    await this.ops.upsertOne(COLLECTION, ["id"], {
      id: project.id, name: project.name, root_path: project.rootPath,
      created_at: project.createdAt, updated_at: project.updatedAt, last_opened_at: project.lastOpenedAt,
    });
  }

  async remove(id: string): Promise<void> {
    await this.ensureReady();
    await this.ops.deleteMany(COLLECTION, { id });
  }

  async dangerouslyClearAll(): Promise<void> {
    await this.ensureReady();
    await this.ops.deleteMany(COLLECTION, {});
  }
}
