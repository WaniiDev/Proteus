/**
 * Browser stand-in for `electrobun/view`, aliased in by vite.preview.config.ts.
 * Serves a RuntimeSnapshot fixture chosen by ?scenario= and applies ?theme=.
 */
import type { RuntimeSnapshot, RuntimeSnapshotEnvelope } from "../src/shared/contracts";
import { encodeRuntimeSnapshot } from "../src/shared/runtime-snapshot-codec";
import { buildFixture, scenarios, type Scenario } from "./fixtures";

const params = new URLSearchParams(location.search);
const requested = params.get("scenario") as Scenario | null;
const scenario: Scenario = requested && (scenarios as readonly string[]).includes(requested) ? requested : "thread";
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.dataset.theme = theme;

let state: RuntimeSnapshot = buildFixture(scenario);
const listeners = new Map<string, Set<(payload: RuntimeSnapshotEnvelope) => void>>();

function publish(next: RuntimeSnapshot): void {
  state = { ...next, revision: state.revision + 1 };
  const envelope = encodeRuntimeSnapshot(state);
  setTimeout(() => listeners.get("runtime.changed")?.forEach((listener) => listener(envelope)), 0);
}

const ok = { accepted: true };
type Params = Record<string, any> | undefined;

const handlers: Record<string, (params: Params) => unknown> = {
  "runtime.bootstrap": () => encodeRuntimeSnapshot(state),
  "threads.select": (p) => { if (!state.threads.some((t) => t.id === p?.threadId)) return { accepted: false }; publish({ ...state, activeThreadId: p!.threadId }); return ok; },
  "threads.switch": (p) => handlers["threads.select"]!(p),
  "threads.rename": (p) => { publish({ ...state, threads: state.threads.map((t) => (t.id === p?.threadId ? { ...t, title: p!.title } : t)) }); return ok; },
  "threads.delete": (p) => { const threads = state.threads.filter((t) => t.id !== p?.threadId); publish({ ...state, threads, activeThreadId: state.activeThreadId === p?.threadId ? null : state.activeThreadId, messages: state.activeThreadId === p?.threadId ? [] : state.messages }); return ok; },
  "threads.create": () => {
    const id = `new-${state.revision}`;
    const now = new Date().toISOString();
    publish({ ...state, threads: [{ id, title: "New chat", createdAt: now, updatedAt: now, activity: "idle", attention: 0, workspace: state.activeWorkspace }, ...state.threads], activeThreadId: id, messages: [] });
    return { threadId: id };
  },
  "models.select": (p) => { const model = state.models.find((m) => m.id === p?.modelId); if (!model) return { accepted: false }; publish({ ...state, selectedModelId: model.id, selectedProviderId: model.providerId }); return ok; },
  "providers.select": (p) => { publish({ ...state, selectedProviderId: p?.providerId }); return ok; },
  "models.reasoning.select": (p) => { publish({ ...state, selectedReasoningEffort: p?.reasoningEffort ?? null }); return ok; },
  "chat.send": () => ({ accepted: false, runId: "preview" }),
  "chat.retry": () => ({ accepted: false, runId: "preview" }),
  "chat.continue": () => ({ accepted: false, runId: "preview" }),
  "chat.interaction.respond": () => ({ accepted: true }),
  "chat.interaction.dismiss": () => ({ accepted: true }),
  "chat.tool-approval.respond": () => ({ accepted: true }),
  "threads.workspace.select": () => ({ accepted: true }),
  "diagnostics.get": () => ({ enabled: true, filePath: "/preview/diagnostics.jsonl", entries: [
    { sequence: 1, timestamp: "2026-10-20T10:00:00.000Z", source: "runtime", type: "run.started", threadId: "th1" },
    { sequence: 2, timestamp: "2026-10-20T10:00:01.000Z", source: "mastra", type: "tool.completed", durationMs: 120 },
  ] }),
  "diagnostics.set-enabled": (p) => ({ enabled: !!p?.enabled, filePath: "/preview/diagnostics.jsonl", entries: [] }),
  "diagnostics.clear": () => ({ enabled: true, filePath: "/preview/diagnostics.jsonl", entries: [] }),
  "diagnostics.export": () => ({ path: "/preview/diagnostics-export.jsonl" }),
  "diagnostics.report-runtime-snapshot-decode": () => ({ accepted: true }),
  "workspace.tree": () => [
    { path: "notes", name: "notes", kind: "directory", children: [{ path: "notes/week.md", name: "week.md", kind: "file", size: 812 }] },
    { path: "README.md", name: "README.md", kind: "file", size: 240 },
  ],
  "workspace.read": (p) => ({ path: p?.path ?? "README.md", kind: "text", content: "# Preview file\n\nMock content.", size: 28, modifiedAt: "2026-10-20T10:00:00.000Z", version: "v1", truncated: false }),
  "workspace.write": (p) => ({ path: p?.path ?? "README.md", kind: "text", content: p?.content ?? "", size: (p?.content ?? "").length, modifiedAt: new Date().toISOString(), version: "v2", truncated: false }),
  "workspace.search": () => [],
  "workspace.index": (p) => ({ indexed: p?.paths?.length ?? 0 }),
  "workspace.skills": () => [],
  "memory.get": () => memoryState(),
  "memory.set-enabled": () => memoryState(),
  "memory.create": () => memoryState(),
  "memory.update": () => memoryState(),
  "memory.delete": () => memoryState(),
  "memory.reset": () => memoryState(),
};

function memoryState() {
  const stamp = "2026-10-20T10:00:00.000Z";
  return {
    enabled: true,
    scopes: [{
      scope: { kind: "global" }, key: "global", label: "Global memory", status: "active",
      entries: [{ id: "mem1", category: "preference", content: "Prefers short answers with a clear next step.", createdAt: stamp, updatedAt: stamp }],
    }],
  };
}

const request = new Proxy({}, {
  get: (_target, name: string) => async (params?: Params) => {
    const handler = handlers[name];
    return handler ? handler(params) : ok;
  },
});

export class Electroview {
  rpc: unknown;
  constructor(config: { rpc: unknown }) { this.rpc = config.rpc; }
  static defineRPC() {
    return {
      request,
      addMessageListener: (name: string, listener: (payload: RuntimeSnapshotEnvelope) => void) => {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(listener);
      },
      removeMessageListener: (name: string, listener: (payload: RuntimeSnapshotEnvelope) => void) => { listeners.get(name)?.delete(listener); },
    };
  }
}
