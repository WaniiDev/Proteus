import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The runtime is a per-process singleton over Electrobun paths; give it a throwaway user-data directory.
let userData = "";
let TextRuntime: typeof import("../runtime").TextRuntime;
const runtimes: Array<{ shutdown(): Promise<void> }> = [];

beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "proteus-thread-service-"));
  mock.module("electrobun/bun", () => ({
    Utils: { paths: { userData }, openExternal: () => undefined, openPath: () => undefined, openFileDialog: async () => [] },
  }));
  ({ TextRuntime } = await import("../runtime"));
}, 60_000);

// Mastra's storage proxy runs the full schema init inside close(); closing runtimes concurrently contends on the one SQLite file, so close them one at a time.
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.shutdown().catch(() => undefined);
});

afterAll(async () => {
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
});

const vault = { get: async () => null, set: async () => undefined, delete: async () => undefined };
const codexStore = { setOAuth: () => undefined, clear: () => undefined } as never;

function threadRow(id: string) {
  return { id, title: id, createdAt: new Date(0), updatedAt: new Date(0), metadata: {} };
}

const stateA = { workspaceBinding: { kind: "project", projectId: "project-a" }, modelSelection: { providerId: "openrouter", modelId: "openrouter/model-a" } };

/** A runtime whose Mastra boundary is replaced by fakes; `failing` thread ids make getThreadById throw. */
function fixture() {
  const runtime = new TextRuntime(vault, codexStore);
  runtimes.push(runtime);
  const rt = runtime as any;
  const failing = new Set<string>();
  const memoryStore = {
    getThreadById: async ({ threadId }: { threadId: string }) => {
      if (failing.has(threadId)) throw new Error("metadata unreadable");
      return { id: threadId, title: threadId, metadata: {} };
    },
    updateThread: async () => undefined,
  };
  rt.threads.storage.getStore = async (name: string) => (name === "memory" ? memoryStore : undefined);
  rt.workspaces.requestContextFor = async () => ({ get: () => undefined });
  rt.threads.projects.list = async () => [];
  const rows = { current: [threadRow("A"), threadRow("B")] };
  const deleted: string[] = [];
  Object.assign(rt.threads.threadRepo, {
    get: async (id: string) => threadRow(id),
    list: async () => rows.current,
    recall: async () => [],
    create: async () => threadRow("new"),
    delete: async (id: string) => { deleted.push(id); rows.current = rows.current.filter((row) => row.id !== id); },
  });
  const driver = { listSuspensions: async () => [] as unknown[], queuedCount: () => 0, ensureSubscription: async (_threadId: string): Promise<void> => undefined, dispose: () => undefined, activeRunId: () => null as string | null, queue: async () => ({ runId: "r1", queued: false }) };
  for (const key of Object.keys(driver)) Object.defineProperty(rt.threads.nativeDriver, key, { configurable: true, get: () => (driver as Record<string, unknown>)[key] });
  const select = (id: string, state: Record<string, unknown>) => {
    rt.ctx.selectedThreadId = id;
    rt.ctx.threadState = state;
    rt.ctx.threadStateCache.set(id, structuredClone(state));
  };
  return { rt, failing, rows, deleted, driver, select };
}

describe("thread load failures (WAN-502)", () => {
  test("startup with one unreadable thread still lists threads and reaches the provider steps", async () => {
    const { rt, failing } = fixture();
    failing.add("A");
    const steps: string[] = [];
    rt.appStorage.init = async () => undefined;
    rt.providers.loadModelPreferences = async () => undefined;
    rt.diagnostics.initialize = async () => undefined;
    rt.providers.refreshCodexModels = async () => { steps.push("models"); };
    rt.providers.validateStoredCredential = async () => { steps.push("credential"); };
    const snapshot = await rt.initialize();
    expect(steps).toEqual(["models", "credential"]);
    expect(snapshot.threads.map((thread: { id: string }) => thread.id)).toEqual(["A", "B"]);
    expect(snapshot.status).not.toBe("error");
    expect(snapshot.error?.retryable).toBeTrue();
    expect(rt.ctx.selectedThreadId).toBeNull();
    // The unreadable thread is never defaulted to the app workspace in the cache.
    expect(rt.ctx.threadStateCache.has("A")).toBeFalse();
  });

  test("a failed switch keeps the previous selection and surfaces the error", async () => {
    const { rt, failing, select } = fixture();
    select("A", stateA);
    failing.add("B");
    await rt.threads.syncThreadState({ threadId: "B" });
    expect(rt.ctx.selectedThreadId).toBe("A");
    expect(rt.ctx.threadState).toEqual(stateA);
    expect(rt.ctx.snapshot.error?.message).toContain("could not be loaded");
    expect(rt.ctx.snapshot.threads).toHaveLength(2);
  });

  test("deleteThread drops the deleted thread even when loading the next one fails", async () => {
    const { rt, failing, select, deleted } = fixture();
    select("A", stateA);
    rt.threads.savedState.set("A", structuredClone(stateA));
    failing.add("B");
    await rt.deleteThread("A");
    expect(deleted).toEqual(["A"]);
    expect(rt.ctx.snapshot.threads.map((thread: { id: string }) => thread.id)).toEqual(["B"]);
    expect(rt.ctx.selectedThreadId).toBeNull();
    expect(rt.ctx.snapshot.activeThreadId).toBeNull();
    expect(rt.ctx.threadStateCache.has("A")).toBeFalse();
    expect(rt.ctx.snapshot.error).not.toBeNull();
  });

  test("deleteThread forgets the thread's saved state and continuation track", async () => {
    const { rt, select } = fixture();
    select("B", { workspaceBinding: { kind: "app" } });
    rt.threads.savedState.set("A", structuredClone(stateA));
    rt.continuation.track("A");
    await rt.deleteThread("A");
    expect(rt.threads.savedState.has("A")).toBeFalse();
    expect(rt.continuation.tracks.has("A")).toBeFalse();
  });

  test("a state deleted while its load is in flight is not re-cached or dereferenced", async () => {
    const { rt, driver } = fixture();
    rt.ctx.threadStateCache.set("A", structuredClone(stateA));
    driver.listSuspensions = async () => { rt.ctx.threadStateCache.delete("A"); return []; };
    const loaded = await rt.threads.loadThreadState("A");
    expect(loaded.workspaceBinding).toEqual(stateA.workspaceBinding);
    expect(rt.ctx.threadStateCache.has("A")).toBeFalse();
  });
});

describe("continuation reconcile (WAN-502)", () => {
  test("a settled continuation clears the snapshot's active run even when another thread is selected", async () => {
    const { rt, select } = fixture();
    select("B", { workspaceBinding: { kind: "app" } });
    rt.ctx.publish({ status: "running", activeRun: { runId: "r9", threadId: "A", status: "running" } });
    await rt.continuation.reconcileContinuation("timeout", { interactionId: "i", toolCallId: "t", threadId: "A", runId: "r9", kind: "tool-approval", decision: "approved", phase: "recovery", startedAt: new Date(0).toISOString(), lastProgressAt: new Date(0).toISOString() });
    expect(rt.ctx.snapshot.activeRun).toBeNull();
    expect(rt.ctx.snapshot.status).not.toBe("running");
  });
});

describe("retry clone cleanup (WAN-503)", () => {
  const message = (id: string, role: string, text: string) => ({ id, role, content: { format: 2, parts: [{ type: "text", text }] }, createdAt: new Date(0) });

  function retryFixture() {
    const f = fixture();
    f.select("A", stateA);
    Object.assign(f.rt.threads.threadRepo, { recall: async () => [message("u1", "user", "hello"), message("a1", "assistant", "hi")] });
    f.rt.runs.memory.cloneThread = async () => { f.rows.current = [...f.rows.current, threadRow("clone")]; return { thread: threadRow("clone") }; };
    f.rt.runs.memory.deleteMessages = async () => undefined;
    return f;
  }

  test("an unreadable clone is removed from the published list and the source stays selected", async () => {
    const { rt, failing, deleted } = retryFixture();
    failing.add("clone");
    const sync = rt.threads.syncThreadState.bind(rt.threads);
    // persistThreadState caches the clone; drop it so the sync really reads the (unreadable) metadata.
    rt.threads.syncThreadState = async (options: { threadId?: string } = {}) => { rt.ctx.threadStateCache.delete(options.threadId); return sync(options); };
    rt.threads.savedState.set("clone", {});
    rt.continuation.track("clone");
    await expect(rt.runs.retryReserved("a1")).rejects.toThrow("could not be loaded");
    expect(deleted).toEqual(["clone"]);
    expect(rt.ctx.snapshot.threads.map((thread: { id: string }) => thread.id)).toEqual(["A", "B"]);
    expect(rt.ctx.selectedThreadId).toBe("A");
    expect(rt.ctx.threadStateCache.has("clone")).toBeFalse();
    expect(rt.threads.savedState.has("clone")).toBeFalse();
    expect(rt.continuation.tracks.has("clone")).toBeFalse();
  });

  test("a one-off clone read failure never starts the run on an unselected clone", async () => {
    const { rt, failing, deleted, driver } = retryFixture();
    let queued = 0;
    driver.queue = async () => { queued += 1; return { runId: "r1", queued: false }; };
    const sync = rt.threads.syncThreadState.bind(rt.threads);
    rt.threads.syncThreadState = async (options: { threadId?: string } = {}) => {
      if (options.threadId === "clone") { failing.add("clone"); rt.ctx.threadStateCache.delete("clone"); }
      try { return await sync(options); } finally { failing.delete("clone"); }
    };
    await expect(rt.runs.retryReserved("a1")).rejects.toThrow("could not be loaded");
    expect(queued).toBe(0);
    expect(deleted).toEqual(["clone"]);
    expect(rt.ctx.selectedThreadId).toBe("A");
    expect(rt.ctx.snapshot.threads.map((thread: { id: string }) => thread.id)).toEqual(["A", "B"]);
  });
});

describe("selectThread load failure (WAN-502)", () => {
  test("a target that fails to load rejects, keeps the selection and does not subscribe", async () => {
    const { rt, failing, select, driver } = fixture();
    select("A", stateA);
    failing.add("B");
    const subscribed: string[] = [];
    driver.ensureSubscription = async (id: string) => { subscribed.push(id); };
    await expect(rt.selectThread("B")).rejects.toThrow("could not be loaded");
    expect(subscribed).not.toContain("B");
    expect(rt.ctx.selectedThreadId).toBe("A");
    expect(rt.ctx.pendingThreadSelectionId).toBeNull();
  });

  test("a readable target is selected and subscribed", async () => {
    const { rt, select, driver } = fixture();
    select("A", stateA);
    const subscribed: string[] = [];
    driver.ensureSubscription = async (id: string) => { subscribed.push(id); };
    await rt.selectThread("B");
    expect(subscribed).toContain("B");
    expect(rt.ctx.selectedThreadId).toBe("B");
  });
});

describe("thread pinning (WAN-513)", () => {
  function pinFixture() {
    const f = fixture();
    const meta = new Map<string, Record<string, unknown>>();
    const row = (id: string, updatedAt: number) => ({ ...threadRow(id), updatedAt: new Date(updatedAt), metadata: meta.get(id) ?? {} });
    f.rows.current = [] as never;
    const refresh = () => { f.rows.current = [row("A", 3000), row("B", 2000), row("C", 1000)] as never; };
    refresh();
    Object.assign(f.rt.threads.threadRepo, {
      get: async (id: string) => (f.rows.current as any[]).find((r) => r.id === id) ?? null,
      list: async () => { refresh(); return f.rows.current; },
      setPinned: async (id: string, pinnedAt: string | null) => {
        if (pinnedAt) meta.set(id, { "proteus.pin.v1": { pinnedAt } }); else meta.delete(id);
      },
    });
    f.select("A", { workspaceBinding: { kind: "app" } });
    return f;
  }
  const ids = (rt: any) => rt.ctx.snapshot.threads.map((t: { id: string }) => t.id);

  test("pin, unpin and ordering by pinnedAt descending", async () => {
    const { rt } = pinFixture();
    await rt.pinThread("C", true);
    await new Promise((r) => setTimeout(r, 5));
    await rt.pinThread("B", true);
    expect(ids(rt)).toEqual(["B", "C", "A"]);
    expect(rt.ctx.snapshot.threads[0].pinned).toBeTrue();
    expect(rt.ctx.snapshot.threads[2].pinned).toBeFalse();
    await rt.pinThread("B", false);
    expect(ids(rt)).toEqual(["C", "A", "B"]);
    expect(rt.ctx.snapshot.threads[2].pinnedAt).toBeNull();
  });

  test("repinning keeps the original pinnedAt and an unknown thread rejects", async () => {
    const { rt } = pinFixture();
    await rt.pinThread("C", true);
    const first = rt.ctx.snapshot.threads[0].pinnedAt;
    await new Promise((r) => setTimeout(r, 5));
    await rt.pinThread("C", true);
    expect(rt.ctx.snapshot.threads[0].pinnedAt).toBe(first);
    rt.threads.threadRepo.get = async () => null;
    await expect(rt.pinThread("zzz", true)).rejects.toThrow("Conversation not found");
  });

  test("deleting the selected thread selects the first thread in pinned-first order (WAN-513)", async () => {
    const { rt, rows, select } = pinFixture();
    select("A", { workspaceBinding: { kind: "app" } });
    // C is the oldest but pinned, so it comes before the newer unpinned B.
    await rt.pinThread("C", true);
    rows.current = [] as never;
    await rt.deleteThread("A");
    expect(rt.ctx.selectedThreadId).toBe("C");
  });
});
