import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, normalize } from "node:path";
import { RequestContext } from "@mastra/core/request-context";
import { Utils } from "electrobun/bun";
import type { ProjectSummary, WorkspaceBinding, WorkspaceBindingUpdateResult, WorkspaceScopeSummary } from "../../shared/contracts";
import { NativeThreadRepository } from "../native/native-thread-repository";
import { NativeAgentDriver } from "../native/native-agent-driver";
import type { ProjectRegistryStorage, StoredProject } from "../project-registry";
import { WorkspaceRegistry } from "../workspace-registry";
import { ScopedMemoryManager } from "../scoped-memory";
import { workspaceSelectionBlocker } from "../workspace-selection-policy";
import type { PersistedThreadState } from "./types";
import { makeRuntimeError } from "../core/runtime-error-mapping";
import type { RuntimeContext } from "./context";
import type { ThreadService } from "./thread-service";

export async function projectSummaries(projects: ProjectRegistryStorage): Promise<ProjectSummary[]> {
  return Promise.all((await projects.list()).map(async (project) => ({
    ...project,
    createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString(), lastOpenedAt: project.lastOpenedAt.toISOString(),
    availability: await stat(project.rootPath).then((entry) => entry.isDirectory() ? "ready" as const : "missing" as const).catch(() => "missing" as const),
  })));
}

export function scopeFor(binding: WorkspaceBinding, projects: ProjectSummary[]): WorkspaceScopeSummary {
  if (binding.kind === "app") return { binding, label: "Proteus workspace", availability: "ready" };
  const project = projects.find((item) => item.id === binding.projectId);
  return { binding, label: project?.name ?? "Missing project", availability: project?.availability ?? "missing" };
}

/** Workspace binding, project registry and the per-thread request context. */
export class WorkspaceService {
  private readonly projects: ProjectRegistryStorage;
  private readonly scopedMemory: ScopedMemoryManager;
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly appWorkspaceRoot: string;
  private readonly nativeDriver: NativeAgentDriver;
  private readonly threadRepo: NativeThreadRepository;
  private readonly threads: ThreadService;

  constructor(private readonly ctx: RuntimeContext, deps: { projects: ProjectRegistryStorage; scopedMemory: ScopedMemoryManager; workspaceRegistry: WorkspaceRegistry; appWorkspaceRoot: string; nativeDriver: NativeAgentDriver; threadRepo: NativeThreadRepository; threads: ThreadService }) {
    this.projects = deps.projects;
    this.scopedMemory = deps.scopedMemory;
    this.workspaceRegistry = deps.workspaceRegistry;
    this.appWorkspaceRoot = deps.appWorkspaceRoot;
    this.nativeDriver = deps.nativeDriver;
    this.threadRepo = deps.threadRepo;
    this.threads = deps.threads;
  }

  async requestContextFor(threadId: string): Promise<RequestContext> {
    const state = await this.threads.loadThreadState(threadId);
    const binding = state.workspaceBinding ?? { kind: "app" as const };
    let rootPath = this.appWorkspaceRoot;
    let projectLabel: string | undefined;
    if (binding.kind === "project") {
      const project = (await projectSummaries(this.projects)).find((item) => item.id === binding.projectId);
      if (!project || project.availability !== "ready") throw new Error("This chat's project folder is unavailable. Reconnect it from Projects before continuing.");
      rootPath = project.rootPath;
      projectLabel = project.name;
    }
    const memoryEnabled = await this.scopedMemory.isEnabled();
    const memoryContext = memoryEnabled
      ? await this.scopedMemory.contextFor(binding.kind === "project" ? binding.projectId : undefined)
      : "";
    return new RequestContext([
      ["proteus-thread-id", threadId],
      ["proteus-workspace-root", rootPath],
      ["proteus-workspace-kind", binding.kind],
      ["proteus-memory-enabled", memoryEnabled],
      ["proteus-memory-context", memoryContext],
      ...(binding.kind === "project" ? [
        ["proteus-project-id", binding.projectId],
        ["proteus-project-label", projectLabel ?? "Current project"],
      ] as Array<[string, unknown]> : []),
    ]);
  }

  async selectedWorkspaceRoot(): Promise<string> {
    if (!this.ctx.selectedThreadId) throw new Error("No conversation is selected");
    const context = await this.requestContextFor(this.ctx.selectedThreadId);
    const root = context.get("proteus-workspace-root");
    if (typeof root !== "string") throw new Error("The selected workspace is unavailable");
    return root;
  }

  async selectWorkspace(workspaceBinding: WorkspaceBinding): Promise<WorkspaceBindingUpdateResult> {
    return this.ctx.enqueueComposerMutation(async () => {
      await this.ctx.ensureInitialized();
      const threadId = this.ctx.selectedThreadId ?? this.ctx.snapshot.activeThreadId;
      if (!threadId) return { accepted: false, code: "failed", message: "No conversation is selected." };
      const runtimeBusy = this.ctx.startingRun || this.ctx.runId !== null || this.ctx.pendingThreadSelectionId !== null || this.ctx.snapshot.activeRun !== null;
      const queuedCount = this.nativeDriver.queuedCount(threadId);
      const busyBlocker = workspaceSelectionBlocker({
        runtimeBusy,
        queuedCount,
        storedMessageCount: 0,
        hasOptimisticMessage: false,
        suspensionCount: 0,
        hasPendingInteraction: false,
      });
      if (busyBlocker) return busyBlocker;
      const [messages, suspensions, state] = await Promise.all([
        this.threadRepo.recall(threadId),
        this.nativeDriver.listSuspensions(threadId).catch(() => []),
        this.threads.loadThreadState(threadId),
      ]);
      const hasOptimisticMessage = [...this.ctx.optimisticUserMessages.values()].some((item) => item.threadId === threadId);
      const hasPendingInteraction = (state.pendingInteractions ?? []).some((item) => item.status === "pending" || item.status === "resolving");
      const blocker = workspaceSelectionBlocker({
        runtimeBusy,
        queuedCount,
        storedMessageCount: messages.length,
        hasOptimisticMessage,
        suspensionCount: suspensions.length,
        hasPendingInteraction,
      });
      if (blocker) return blocker;

      if (workspaceBinding.kind === "project") {
        const project = (await projectSummaries(this.projects)).find((item) => item.id === workspaceBinding.projectId);
        if (!project || project.availability !== "ready") {
          return { accepted: false, code: "project-unavailable", message: "Reconnect this project folder before using it in a conversation." };
        }
      }

      const nextState: PersistedThreadState = { ...state, workspaceBinding };
      try {
        await this.threads.persistThreadState(threadId, nextState, true);
      } catch {
        this.ctx.threadStateCache.set(threadId, structuredClone(state));
        return { accepted: false, code: "failed", message: "The project selection could not be saved." };
      }
      this.ctx.threadState = nextState;
      await this.threads.syncThreadState();
      return { accepted: true };
    });
  }

  private async chooseProjectDirectory(): Promise<string | null> {
    const selected = await Utils.openFileDialog({ canChooseFiles: false, canChooseDirectory: true, allowsMultipleSelection: false });
    const candidate = selected.find((value) => value.trim())?.trim();
    if (!candidate) return null;
    const rootPath = await realpath(candidate);
    if (!(await stat(rootPath)).isDirectory()) throw new Error("Choose a folder for the project");
    return rootPath;
  }

  async attachProject(projectId?: string): Promise<boolean> {
    await this.ctx.ensureInitialized();
    if (this.ctx.startingRun || this.ctx.runId) throw makeRuntimeError("busy");
    const rootPath = await this.chooseProjectDirectory();
    if (!rootPath) return false;
    const now = new Date();
    const existing = (await this.projects.list()).find((item) => item.id === projectId || normalize(item.rootPath).toLowerCase() === normalize(rootPath).toLowerCase());
    const project: StoredProject = { id: existing?.id ?? randomUUID(), name: basename(rootPath), rootPath, createdAt: existing?.createdAt ?? now, updatedAt: now, lastOpenedAt: now };
    await this.projects.save(project);
    await this.threads.syncThreadState();
    return true;
  }

  async removeProject(projectId: string): Promise<void> {
    await this.ctx.ensureInitialized();
    const project = (await this.projects.list()).find((item) => item.id === projectId);
    await this.scopedMemory.archiveProject(projectId);
    await this.projects.remove(projectId);
    if (project) await this.workspaceRegistry.remove(project.rootPath).catch(() => undefined);
    await this.threads.syncThreadState();
  }

  async openProject(projectId: string): Promise<void> {
    const project = (await this.projects.list()).find((item) => item.id === projectId);
    if (!project) throw new Error("Project not found");
    await stat(project.rootPath);
    Utils.openPath(project.rootPath);
    await this.projects.save({ ...project, lastOpenedAt: new Date() });
    await this.threads.syncThreadState();
  }
}
