import { randomUUID } from "node:crypto";
import type { MastraCompositeStore } from "@mastra/core/storage";
import { Memory } from "@mastra/memory";
import {
  memoryEntrySchema,
  memoryScopeSchema,
  type MemoryCategory,
  type MemoryEntry,
  type MemoryScope,
  type MemoryScopeState,
  type MemorySettingsState,
} from "../shared/contracts";
import type { MemorySettingsStorage, StoredMemoryScope } from "./memory-settings";
import type { StoredProject } from "./project-registry";

const WORKING_MEMORY_TEMPLATE = `# Proteus durable memory

This resource contains a Proteus-owned JSON document. Proteus updates it through explicit,
deterministic memory controls. Do not rewrite it from ordinary conversation history.`;
const MEMORY_DOCUMENT_VERSION = 1;
export const MEMORY_CONTEXT_LIMIT = 6_000;

type MemoryDocument = { version: 1; entries: MemoryEntry[] };

export class ScopedMemoryManager {
  private readonly memory: Memory;
  private readonly mutationQueues = new Map<string, Promise<void>>();

  constructor(
    storage: MastraCompositeStore,
    private readonly settings: MemorySettingsStorage,
  ) {
    this.memory = new Memory({
      storage,
      vector: false,
      options: {
        lastMessages: false,
        semanticRecall: false,
        generateTitle: false,
        workingMemory: {
          enabled: true,
          scope: "resource",
          template: WORKING_MEMORY_TEMPLATE,
        },
      },
    });
  }

  isEnabled(): Promise<boolean> {
    return this.settings.loadEnabled();
  }

  async setEnabled(enabled: boolean, projects: StoredProject[]): Promise<MemorySettingsState> {
    await this.settings.setEnabled(enabled);
    return this.getState(projects);
  }

  async getState(projects: StoredProject[], requestedScope?: MemoryScope): Promise<MemorySettingsState> {
    await this.ensureScope({ kind: "global" }, "All conversations");
    for (const project of projects) await this.ensureScope({ kind: "project", projectId: project.id }, project.name);
    if (requestedScope?.kind === "project") {
      const project = projects.find((item) => item.id === requestedScope.projectId);
      const existing = await this.settings.getScope(scopeKey(requestedScope));
      await this.ensureScope(requestedScope, project?.name ?? existing?.label ?? "Archived project");
    }

    const scopes = await this.settings.listScopes();
    return {
      enabled: await this.settings.loadEnabled(),
      scopes: await Promise.all(scopes.map((scope) => this.readScopeState(scope))),
    };
  }

  async create(scope: MemoryScope, category: MemoryCategory, content: string, label: string): Promise<MemoryEntry> {
    return this.mutate(scope, label, (document) => {
      const now = new Date().toISOString();
      const entry = memoryEntrySchema.parse({ id: randomUUID(), category, content, createdAt: now, updatedAt: now });
      document.entries.push(entry);
      return entry;
    });
  }

  async update(scope: MemoryScope, id: string, category: MemoryCategory, content: string, label: string): Promise<MemoryEntry> {
    return this.mutate(scope, label, (document) => {
      const index = document.entries.findIndex((entry) => entry.id === id);
      if (index < 0) throw new Error("Memory entry not found");
      const entry = memoryEntrySchema.parse({
        ...document.entries[index],
        category,
        content,
        updatedAt: new Date().toISOString(),
      });
      document.entries[index] = entry;
      return entry;
    });
  }

  async delete(scope: MemoryScope, id: string, label: string): Promise<void> {
    await this.mutate(scope, label, (document) => {
      const next = document.entries.filter((entry) => entry.id !== id);
      if (next.length === document.entries.length) throw new Error("Memory entry not found");
      document.entries = next;
    });
  }

  async reset(scope: MemoryScope, label: string): Promise<void> {
    await this.mutate(scope, label, (document) => {
      document.entries = [];
    });
  }

  archiveProject(projectId: string): Promise<void> {
    return this.settings.archiveProject(projectId);
  }

  async contextFor(projectId?: string): Promise<string> {
    if (!(await this.settings.loadEnabled())) return "";
    const sections: string[] = [];
    const global = await this.readDocument({ kind: "global" });
    if (global.entries.length > 0) sections.push(formatScopeContext("Global memory", global.entries));
    if (projectId) {
      const project = await this.readDocument({ kind: "project", projectId });
      if (project.entries.length > 0) sections.push(formatScopeContext("Current project memory", project.entries));
    }
    const context = sections.filter(Boolean).join("\n\n");
    if (!context) return "";
    return context.length <= MEMORY_CONTEXT_LIMIT
      ? context
      : `${context.slice(0, MEMORY_CONTEXT_LIMIT - 21).trimEnd()}\n[Memory truncated]`;
  }

  private async mutate<T>(
    scopeInput: MemoryScope,
    label: string,
    mutation: (document: MemoryDocument) => T,
  ): Promise<T> {
    const scope = memoryScopeSchema.parse(scopeInput);
    const key = scopeKey(scope);
    let result!: T;
    const previous = this.mutationQueues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      const stored = await this.ensureScope(scope, label);
      const document = await this.readDocument(scope);
      result = mutation(document);
      await this.writeDocument(scope, document);
      await this.settings.saveScope({ ...stored, label, updatedAt: new Date() });
    });
    this.mutationQueues.set(key, current);
    try {
      await current;
      return result;
    } finally {
      if (this.mutationQueues.get(key) === current) this.mutationQueues.delete(key);
    }
  }

  private async readScopeState(scope: StoredMemoryScope): Promise<MemoryScopeState> {
    const publicScope: MemoryScope = scope.kind === "project" && scope.projectId
      ? { kind: "project", projectId: scope.projectId }
      : { kind: "global" };
    const document = await this.readDocument(publicScope);
    return {
      scope: publicScope,
      key: scope.key,
      label: scope.label,
      status: scope.archived ? "archived" : "active",
      entries: [...document.entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  }

  private async ensureScope(scope: MemoryScope, label: string): Promise<StoredMemoryScope> {
    const key = scopeKey(scope);
    const existing = await this.settings.getScope(key);
    if (existing) {
      if (existing.label !== label && !existing.archived) {
        const updated = { ...existing, label, updatedAt: new Date() };
        await this.settings.saveScope(updated);
        return updated;
      }
      return existing;
    }
    const now = new Date();
    const stored: StoredMemoryScope = {
      key,
      kind: scope.kind,
      ...(scope.kind === "project" ? { projectId: scope.projectId } : {}),
      label,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.settings.saveScope(stored);
    return stored;
  }

  private async readDocument(scope: MemoryScope): Promise<MemoryDocument> {
    const identifiers = memoryIdentifiers(scope);
    await this.ensureMemoryThread(identifiers);
    const raw = await this.memory.getWorkingMemory(identifiers);
    if (!raw) return emptyDocument();
    try {
      const parsed = JSON.parse(raw) as { version?: unknown; entries?: unknown };
      const entries = memoryEntrySchema.array().safeParse(parsed.entries);
      return parsed.version === MEMORY_DOCUMENT_VERSION && entries.success
        ? { version: MEMORY_DOCUMENT_VERSION, entries: entries.data }
        : emptyDocument();
    } catch {
      return emptyDocument();
    }
  }

  private async writeDocument(scope: MemoryScope, document: MemoryDocument): Promise<void> {
    const identifiers = memoryIdentifiers(scope);
    await this.ensureMemoryThread(identifiers);
    await this.memory.updateWorkingMemory({
      ...identifiers,
      workingMemory: JSON.stringify(document),
    });
  }

  private async ensureMemoryThread(identifiers: { threadId: string; resourceId: string }): Promise<void> {
    const existing = await this.memory.getThreadById(identifiers);
    if (existing) return;
    await this.memory.createThread({
      ...identifiers,
      title: "Proteus memory",
      metadata: { hidden: true, purpose: "proteus-working-memory" },
      saveThread: true,
    });
  }
}

export function scopeKey(scope: MemoryScope): string {
  return scope.kind === "global" ? "global" : `project:${scope.projectId}`;
}

function memoryIdentifiers(scope: MemoryScope): { threadId: string; resourceId: string } {
  const key = scopeKey(scope);
  return {
    threadId: `proteus-memory:${key}`,
    resourceId: `proteus-memory:${key}`,
  };
}

function emptyDocument(): MemoryDocument {
  return { version: MEMORY_DOCUMENT_VERSION, entries: [] };
}

function formatScopeContext(label: string, entries: MemoryEntry[]): string {
  const categoryOrder: MemoryCategory[] = ["profile", "preference", "work-style", "goal", "project-context", "decision"];
  const lines = [`## ${label}`];
  for (const category of categoryOrder) {
    const categoryEntries = entries
      .filter((entry) => entry.category === category)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (categoryEntries.length === 0) continue;
    lines.push(`### ${category}`);
    for (const entry of categoryEntries) lines.push(`- [${entry.id}] ${entry.content}`);
  }
  return lines.join("\n");
}
