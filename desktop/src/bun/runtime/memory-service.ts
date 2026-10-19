import type { MemoryCategory, MemoryScope, MemorySettingsState } from "../../shared/contracts";
import type { ProjectRegistryStorage, StoredProject } from "../workspace/project-registry";
import { ScopedMemoryManager } from "../memory/scoped-memory";
import type { RuntimeContext } from "./context";

/** Scoped durable memory settings and entries. */
export class MemoryService {
  private readonly projects: ProjectRegistryStorage;
  private readonly scopedMemory: ScopedMemoryManager;

  constructor(private readonly ctx: RuntimeContext, deps: { projects: ProjectRegistryStorage; scopedMemory: ScopedMemoryManager }) {
    this.projects = deps.projects;
    this.scopedMemory = deps.scopedMemory;
  }

  async getMemoryState(scope?: MemoryScope): Promise<MemorySettingsState> {
    await this.ctx.ensureInitialized();
    return this.scopedMemory.getState(await this.projects.list(), scope);
  }

  async setMemoryEnabled(enabled: boolean): Promise<MemorySettingsState> {
    await this.ctx.ensureInitialized();
    return this.scopedMemory.setEnabled(enabled, await this.projects.list());
  }

  async createMemory(scope: MemoryScope, category: MemoryCategory, content: string): Promise<MemorySettingsState> {
    await this.ctx.ensureInitialized();
    const projects = await this.projects.list();
    await this.scopedMemory.create(scope, category, content, await this.memoryScopeLabel(scope, projects));
    return this.scopedMemory.getState(projects, scope);
  }

  async updateMemory(scope: MemoryScope, id: string, category: MemoryCategory, content: string): Promise<MemorySettingsState> {
    await this.ctx.ensureInitialized();
    const projects = await this.projects.list();
    await this.scopedMemory.update(scope, id, category, content, await this.memoryScopeLabel(scope, projects));
    return this.scopedMemory.getState(projects, scope);
  }

  async deleteMemory(scope: MemoryScope, id: string): Promise<MemorySettingsState> {
    await this.ctx.ensureInitialized();
    const projects = await this.projects.list();
    await this.scopedMemory.delete(scope, id, await this.memoryScopeLabel(scope, projects));
    return this.scopedMemory.getState(projects, scope);
  }

  async resetMemory(scope: MemoryScope): Promise<MemorySettingsState> {
    await this.ctx.ensureInitialized();
    const projects = await this.projects.list();
    await this.scopedMemory.reset(scope, await this.memoryScopeLabel(scope, projects));
    return this.scopedMemory.getState(projects, scope);
  }

  private async memoryScopeLabel(scope: MemoryScope, projects: StoredProject[]): Promise<string> {
    if (scope.kind === "global") return "All conversations";
    const project = projects.find((item) => item.id === scope.projectId);
    if (project) return project.name;
    const state = await this.scopedMemory.getState(projects, scope);
    return state.scopes.find((item) => item.key === `project:${scope.projectId}`)?.label ?? "Archived project";
  }
}
