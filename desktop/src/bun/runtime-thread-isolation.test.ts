import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approvalFingerprint } from "./tools/approval-policy";
import { parseSuspendedInteraction, parseToolApproval } from "./core/runtime-projection";

// The runtime is a per-process singleton over Electrobun paths; give it a throwaway user-data directory.
let userData = "";
let TextRuntime: typeof import("./runtime").TextRuntime;
const runtimes: Array<{ shutdown(): Promise<void> }> = [];

beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "proteus-isolation-"));
  mock.module("electrobun/bun", () => ({
    Utils: { paths: { userData }, openExternal: () => undefined, openPath: () => undefined, openFileDialog: async () => [] },
  }));
  const realCodexAuth = await import("@mastra/code-sdk/auth/providers/openai-codex");
  mock.module("@mastra/code-sdk/auth/providers/openai-codex", () => ({
    ...realCodexAuth,
    loginOpenAICodex: ({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("Login cancelled")));
    }),
  }));
  ({ TextRuntime } = await import("./runtime"));
}, 60_000);

// Mastra's storage proxy runs the full schema init inside close(), even for runtimes whose init the fixture bypassed. Closing all of
// them in one afterAll made ~27 concurrent inits contend on the one SQLite file (~1s idle, near the 5s hook limit under CPU load), so
// each test closes its own runtimes one at a time and the file is already initialised for all but the first.
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.shutdown().catch(() => undefined);
});

afterAll(async () => {
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
});

const vault = { get: async () => null, set: async () => undefined, delete: async () => undefined };
const codexStore = { setOAuth: () => undefined, clear: () => undefined } as never;

type Writes = Array<{ id: string; state: Record<string, unknown> }>;

function threadRow(id: string) {
  return { id, title: id, createdAt: new Date(0), updatedAt: new Date(0), metadata: {} };
}

/** A runtime whose Mastra boundary (storage, driver, request context) is replaced by recording fakes. */
function fixture(options: { failWrites?: boolean } = {}) {
  const runtime = new TextRuntime(vault, codexStore);
  runtimes.push(runtime);
  const rt = runtime as any;
  const writes: Writes = [];
  const gates = { load: null as Promise<void> | null };
  const memoryStore = {
    getThreadById: async ({ threadId }: { threadId: string }) => {
      if (gates.load) await gates.load;
      return { id: threadId, title: threadId, metadata: {} };
    },
    updateThread: async ({ id, metadata }: { id: string; metadata: Record<string, unknown> }) => {
      if (options.failWrites) throw new Error("disk full");
      writes.push({ id, state: metadata["proteus.ui.v2"] as Record<string, unknown> });
    },
  };
  // The services share these Mastra boundary objects, so patching them in place reaches every service.
  rt.threads.storage.getStore = async (name: string) => (name === "memory" ? memoryStore : undefined);
  rt.ctx.ensureInitialized = async () => undefined;
  rt.workspaces.requestContextFor = async () => ({ get: () => undefined });
  rt.threads.projects.list = async () => [];
  Object.assign(rt.threads.threadRepo, { get: async (id: string) => threadRow(id), list: async () => [threadRow("A"), threadRow("B")], recall: async () => [], create: async () => threadRow("new") });
  const calls = { abort: [] as string[], queue: 0 };
  const driver = {
    findSuspension: async () => null as unknown,
    resume: async () => ({ runId: "r1" }),
    approve: async () => ({ runId: "r1" }),
    abort: (threadId: string) => { calls.abort.push(threadId); return false; },
    activeRunId: () => null,
    listSuspensions: async () => [],
    queuedCount: () => 0,
    ensureSubscription: async () => undefined,
    queue: async () => { calls.queue += 1; return { runId: "r1", queued: false }; },
    dispose: () => undefined,
  };
  // Every service holds the one real driver; route its methods to the recording fake.
  for (const key of Object.keys(driver)) Object.defineProperty(rt.threads.nativeDriver, key, { configurable: true, get: () => (driver as Record<string, unknown>)[key] });
  const select = (id: string, state: Record<string, unknown>) => {
    rt.ctx.selectedThreadId = id;
    rt.ctx.threadState = state;
    rt.ctx.threadStateCache.set(id, structuredClone(state));
  };
  return { rt, writes, driver, calls, gates, select };
}

const stateA = { workspaceBinding: { kind: "project", projectId: "project-a" }, modelSelection: { providerId: "openrouter", modelId: "openrouter/model-a" } };
const stateB = { workspaceBinding: { kind: "app" }, modelSelection: { providerId: "codex", modelId: "codex/model-b" } };

function approvalFor(threadId: string, toolCallId = "t1") {
  return parseToolApproval({ threadId, runId: "r1", toolCallId, toolName: "mastra_workspace_write_file", args: { path: "a.txt" } });
}

function projection(threadId: string, runId = "r1", terminal: string | null = null) {
  return { runId, threadId, message: { id: `${runId}:m`, role: "assistant", turnId: runId, parts: [], status: "streaming", createdAt: new Date(0).toISOString() }, terminal } as never;
}

describe("runtime thread isolation (WAN-503)", () => {
  test("H1: approving in A then switching to B persists A's own state", async () => {
    const { rt, writes, driver, select } = fixture();
    const pending = approvalFor("A");
    select("A", { ...stateA, pendingInteractions: [pending] });
    driver.findSuspension = async () => ({ runId: "r1", toolCallId: "t1", toolName: pending.toolName, args: { path: "a.txt" }, requiresApproval: true });
    driver.approve = async () => {
      select("B", stateB);
      return { runId: "r1" };
    };
    expect(await rt.respondToToolApproval("t1", true, approvalFingerprint(pending.toolName!, { path: "a.txt" }))).toEqual({ accepted: true });
    const savedForA = writes.filter((write) => write.id === "A");
    expect(savedForA.length).toBeGreaterThan(0);
    for (const write of savedForA) {
      expect(write.state.workspaceBinding).toEqual(stateA.workspaceBinding);
      expect(write.state.modelSelection).toEqual(stateA.modelSelection);
    }
    expect(savedForA.at(-1)?.state.continuation).toMatchObject({ threadId: "A", toolCallId: "t1" });
    expect(rt.ctx.threadState).toEqual(stateB);
  });

  test("H1: answering a plan in A then switching to B resolves it in A only", async () => {
    const { rt, writes, driver, select } = fixture();
    const plan = { ...parseSuspendedInteraction({ toolCallId: "p1", toolName: "submit_plan", suspendPayload: { path: "p.md", plan: "# Plan" } }, 1)!, threadId: "A", runId: "r1" };
    select("A", { ...stateA, pendingInteractions: [plan] });
    driver.findSuspension = async () => ({ runId: "r1", toolCallId: "p1", toolName: "submit_plan", requiresApproval: false });
    driver.resume = async () => {
      select("B", stateB);
      return { runId: "r1" };
    };
    expect(await rt.respondToInteraction("p1", { action: "approved" })).toEqual({ accepted: true });
    const last = writes.filter((write) => write.id === "A").at(-1)!;
    expect(last.state.workspaceBinding).toEqual(stateA.workspaceBinding);
    expect((last.state.pendingInteractions as unknown[]) ?? []).toEqual([]);
    expect((last.state.resolvedInteractions as Array<{ toolCallId: string }>).map((item) => item.toolCallId)).toContain("p1");
    expect(rt.ctx.threadState).toEqual(stateB);
  });

  test("H2: the selection changes only after the target thread loaded", async () => {
    const { rt, gates, select } = fixture();
    select("A", stateA);
    let release!: () => void;
    gates.load = new Promise<void>((resolve) => { release = resolve; });
    rt.ctx.threadStateCache.delete("B");
    const switching = rt.selectThread("B");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rt.ctx.selectedThreadId).toBe("A");
    expect(rt.ctx.threadState).toEqual(stateA);
    release();
    gates.load = null;
    await switching;
    expect(rt.ctx.selectedThreadId).toBe("B");
    expect(rt.ctx.threadStateCache.get("A")).toMatchObject({ workspaceBinding: stateA.workspaceBinding, modelSelection: stateA.modelSelection });
  });

  test("H3: a suspension from a background thread never reaches the selected thread", async () => {
    const { rt, select } = fixture();
    select("B", stateB);
    select("A", stateA);
    select("B", stateB);
    rt.runs.handleNativeProjection(projection("A"), { type: "tool-call-approval", payload: { toolCallId: "t1", toolName: "mastra_workspace_write_file", args: { path: "a.txt" } } });
    expect(rt.ctx.threadState.pendingInteractions ?? []).toEqual([]);
    expect(rt.ctx.snapshot.interactions).toEqual([]);
    expect(rt.ctx.threadStateCache.get("A")?.pendingInteractions?.map((item: { toolCallId: string }) => item.toolCallId)).toEqual(["t1"]);
    expect(rt.ctx.threadActivity.get("A")).toMatchObject({ activity: "waiting" });
  });

  test("H3: plan versions count within the suspended thread", async () => {
    const { rt, select } = fixture();
    const earlier = { ...parseSuspendedInteraction({ toolCallId: "old", toolName: "submit_plan", suspendPayload: { path: "p.md", plan: "# Old" } }, 7)!, status: "approved" as const };
    select("B", { ...stateB, resolvedInteractions: [earlier] });
    rt.ctx.threadStateCache.set("A", structuredClone(stateA));
    rt.runs.handleNativeProjection(projection("A"), { type: "tool-call-suspended", payload: { toolCallId: "p1", toolName: "submit_plan", suspendPayload: { path: "../outside.md" } } });
    expect(rt.ctx.threadStateCache.get("A")?.pendingInteractions?.[0]?.plan?.version).toBe(1);
  });

  test("H4: abort returns to idle when Mastra has no run to abort", () => {
    const { rt, calls, select } = fixture();
    select("A", stateA);
    rt.ctx.runId = "r1";
    rt.ctx.runThreadId = "A";
    rt.ctx.snapshot.status = "running";
    rt.ctx.snapshot.activeRun = { runId: "r1", threadId: "A", status: "running" };
    rt.abort();
    expect(calls.abort).toEqual(["A"]);
    expect(rt.ctx.runId).toBeNull();
    expect(rt.ctx.snapshot.activeRun).toBeNull();
    expect(rt.ctx.snapshot.status).not.toBe("running");
    expect(rt.ctx.snapshot.error?.code).toBe("aborted");
  });

  test("H4: abort targets the thread that owns the run, not the selected one", () => {
    const { rt, calls, driver, select } = fixture();
    select("B", stateB);
    rt.ctx.runId = "r1";
    rt.ctx.runThreadId = "A";
    driver.abort = (threadId: string) => { calls.abort.push(threadId); return true; };
    rt.abort();
    expect(calls.abort).toEqual(["A"]);
    expect(rt.ctx.runId).toBe("r1");
  });

  test("M1: continuation progress and finish match the thread, not the selection", () => {
    const { rt, select } = fixture();
    const continuation = { interactionId: "i", toolCallId: "t1", threadId: "A", runId: "r1", kind: "tool_approval", decision: "approved", phase: "slow", startedAt: new Date(0).toISOString(), lastProgressAt: new Date(0).toISOString() };
    select("B", stateB);
    rt.ctx.threadStateCache.set("A", { ...stateA, continuation });
    rt.continuation.markContinuationProgress({ type: "text-delta", payload: { text: "hi" } }, "A", "r1");
    expect(rt.ctx.threadStateCache.get("A").continuation.phase).toBe("resuming");
    rt.continuation.finishContinuation("A", "r1", "complete");
    expect(rt.ctx.threadStateCache.get("A").continuation).toBeNull();
    expect(rt.ctx.threadState.continuation).toBeUndefined();
    rt.continuation.clearContinuationTimers();
  });

  test("M2: a failed queue call rolls the optimistic message back", async () => {
    const { rt, driver, select } = fixture();
    select("A", stateA);
    driver.queue = async () => { throw new Error("blocked"); };
    await expect(rt.runs.queueNativeMessage("A", "hello", { clientMessageId: "m1", optimistic: true })).rejects.toThrow("blocked");
    expect(rt.ctx.optimisticUserMessages.size).toBe(0);
    expect(rt.ctx.snapshot.messages.some((message: { id: string }) => message.id === "m1")).toBeFalse();
  });

  test("L2: a failed write neither keeps the cache ahead of storage nor stays silent", async () => {
    const { rt } = fixture({ failWrites: true });
    rt.ctx.threadStateCache.set("A", structuredClone(stateA));
    await rt.threads.persistThreadState("A", { ...stateA, events: [{ id: "e", type: "system", text: "x", createdAt: "" }] });
    expect(rt.ctx.threadStateCache.get("A")).toEqual(stateA);
    expect(rt.ctx.snapshot.error?.message).toContain("could not be saved");
    await expect(rt.threads.persistThreadState("A", { ...stateA, events: [] }, true)).rejects.toThrow("disk full");
    expect(rt.ctx.threadStateCache.get("A")).toEqual(stateA);
  });

  test("L3: a stream error from another thread leaves the owning run alone", () => {
    const { rt, select } = fixture();
    select("A", stateA);
    rt.ctx.threadStateCache.set("B", structuredClone(stateB));
    rt.ctx.runId = "r1";
    rt.ctx.runThreadId = "A";
    rt.runs.handleNativeDriverError(new Error("boom"), "B");
    expect(rt.ctx.runId).toBe("r1");
    rt.runs.handleNativeDriverError(new Error("boom"), "A");
    expect(rt.ctx.runId).toBeNull();
  });

  test("L5: an abort requested while preparing a retry creates no orphan clone", async () => {
    const { rt, select } = fixture();
    select("A", stateA);
    const message = (id: string, role: string, text: string) => ({ id, role, content: { format: 2, parts: [{ type: "text", text }] }, createdAt: new Date(0) });
    rt.threads.threadRepo.recall = async () => [message("u1", "user", "hello"), message("a1", "assistant", "hi")];
    rt.threads.loadThreadState = async () => {
      rt.ctx.startingRunAbortRequested = true;
      return structuredClone(stateA);
    };
    let clones = 0;
    rt.runs.memory.cloneThread = async () => { clones += 1; return { thread: threadRow("clone") }; };
    await expect(rt.runs.retryReserved("a1")).rejects.toMatchObject({ code: "aborted" });
    expect(clones).toBe(0);
  });
});

describe("review fixes (WAN-503)", () => {
  test("R1: a failed continuation save is surfaced, not swallowed", async () => {
    const { rt, driver, select } = fixture({ failWrites: true });
    const pending = approvalFor("A");
    select("A", { ...stateA, pendingInteractions: [pending] });
    driver.findSuspension = async () => ({ runId: "r1", toolCallId: "t1", toolName: pending.toolName, args: { path: "a.txt" }, requiresApproval: true });
    expect(await rt.respondToToolApproval("t1", true, approvalFingerprint(pending.toolName!, { path: "a.txt" }))).toEqual({ accepted: true });
    expect(rt.ctx.snapshot.error?.message).toContain("could not be saved");
    rt.continuation.clearContinuationTimers();
  });
});

describe("review fixes: background run clears the shared activeRun (WAN-503)", () => {
  function runningInA(rt: any, select: (id: string, state: Record<string, unknown>) => void) {
    select("B", stateB);
    rt.ctx.runId = "r1";
    rt.ctx.runThreadId = "A";
    rt.ctx.snapshot.status = "running";
    rt.ctx.snapshot.activeRun = { runId: "r1", threadId: "A", status: "running" };
  }

  test("R2: aborting a run of another thread with nothing to abort returns to idle", () => {
    const { rt, select } = fixture();
    runningInA(rt, select);
    rt.abort();
    expect(rt.ctx.snapshot.activeRun).toBeNull();
    expect(rt.ctx.snapshot.status).not.toBe("running");
  });

  test("R2: the terminal chunk of an aborted background run clears the selected snapshot", () => {
    const { rt, driver, select } = fixture();
    runningInA(rt, select);
    driver.abort = () => true;
    rt.abort();
    rt.runs.handleNativeProjection(projection("A", "r1", "interrupted"), { type: "abort", payload: {} });
    expect(rt.ctx.snapshot.activeRun).toBeNull();
    expect(rt.ctx.snapshot.status).not.toBe("running");
  });

  test("R2: a stream error of a background run clears the selected snapshot", async () => {
    const { rt, select } = fixture();
    runningInA(rt, select);
    rt.threads.refreshNativeTasks = async () => undefined;
    rt.runs.handleNativeDriverError(new Error("boom"), "A");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rt.ctx.snapshot.activeRun).toBeNull();
    expect(rt.ctx.snapshot.status).not.toBe("running");
  });
});

describe("review fixes: approval publish (WAN-503)", () => {
  test("R3: switching away while the approval is checked keeps A's resolving state out of B's snapshot", async () => {
    const { rt, driver, select } = fixture();
    const pending = approvalFor("A");
    select("A", { ...stateA, pendingInteractions: [pending] });
    driver.findSuspension = async () => {
      select("B", stateB);
      return { runId: "r1", toolCallId: "t1", toolName: pending.toolName, args: { path: "a.txt" }, requiresApproval: true };
    };
    await rt.respondToToolApproval("t1", true, approvalFingerprint(pending.toolName!, { path: "a.txt" }));
    expect(rt.ctx.snapshot.interactions).toEqual([]);
    rt.continuation.clearContinuationTimers();
  });
});

describe("review fixes: continuation history (WAN-503)", () => {
  const continuationFor = (threadId: string) => ({ interactionId: "i", toolCallId: "t1", threadId, runId: "r1", kind: "tool_approval", decision: "approved", phase: "recovery", startedAt: new Date(0).toISOString(), lastProgressAt: new Date(0).toISOString() });
  const assistant = (text: string) => ({ id: "a1", role: "assistant", content: { format: 2, parts: [{ type: "text", text }] }, createdAt: new Date() });

  function reconcileSetup(recalled: Record<string, unknown[]>, selectedMessages: unknown[]) {
    const ctxt: ReturnType<typeof fixture> = fixture();
    const { rt, select } = ctxt;
    select("B", stateB);
    rt.ctx.snapshot.messages = selectedMessages;
    rt.threads.threadRepo.recall = async (id: string) => recalled[id] ?? [];
    const events: Array<{ type: string; phase?: string }> = [];
    rt.continuation.diagnostics.record = (event: { type: string; phase?: string }) => { events.push(event); };
    return { ...ctxt, events };
  }

  test("R4: reconciling A while B is selected does not read B's messages as A's completion", async () => {
    const done = { id: "b1", role: "assistant", text: "finished", status: "complete", createdAt: new Date().toISOString(), parts: [{ type: "text", id: "x", text: "finished" }], turnId: "t" };
    const { rt, events } = reconcileSetup({}, [done]);
    rt.ctx.threadStateCache.set("A", { ...stateA, continuation: continuationFor("A") });
    await rt.continuation.reconcileContinuation("timeout", continuationFor("A"));
    expect(events.some((event) => event.type === "continuation_reconcile" && event.phase === "missing")).toBeTrue();
  });

  test("R4: reconciling A while B is selected finds A's own completed history", async () => {
    const { rt, events } = reconcileSetup({ A: [assistant("all done")] }, []);
    rt.ctx.threadStateCache.set("A", { ...stateA, continuation: continuationFor("A") });
    await rt.continuation.reconcileContinuation("timeout", continuationFor("A"));
    expect(events.some((event) => event.type === "continuation_reconcile" && event.phase === "missing")).toBeFalse();
    expect(events.some((event) => event.type === "continuation" && event.phase === "complete")).toBeTrue();
  });
});

describe("review fixes: loadThreadState (WAN-503)", () => {
  test("R5: a background update made while suspensions are read is not overwritten", async () => {
    const { rt, driver, select } = fixture();
    select("A", stateA);
    const continuation = { interactionId: "i", toolCallId: "t1", threadId: "B", runId: "r1", kind: "tool_approval", decision: "approved", phase: "resuming", startedAt: new Date(0).toISOString(), lastProgressAt: new Date(0).toISOString() };
    rt.ctx.threadStateCache.set("B", { ...stateB, continuation });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    driver.listSuspensions = async () => { await gate; return []; };
    const loading = rt.threads.loadThreadState("B");
    rt.continuation.finishContinuation("B", "r1", "complete");
    release();
    const loaded = await loading;
    expect(rt.ctx.threadStateCache.get("B").continuation).toBeNull();
    expect(loaded.continuation ?? null).toBeNull();
  });
});

describe("review fixes: createThread (WAN-503)", () => {
  test("R6: the new thread is selected only once it has loaded", async () => {
    const { rt, select } = fixture();
    select("A", stateA);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    Object.assign(rt.threads.threadRepo, {
      create: async () => threadRow("new"),
      list: async () => { await gate; return [threadRow("A"), threadRow("B"), threadRow("new")]; },
    });
    const creating = rt.createThread("fresh");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rt.ctx.selectedThreadId).toBe("A");
    release();
    expect(await creating).toBe("new");
    expect(rt.ctx.selectedThreadId).toBe("new");
    expect(rt.ctx.threadStateCache.get("A")).toMatchObject({ workspaceBinding: stateA.workspaceBinding });
  });
});

describe("review fixes: retry clone (WAN-503)", () => {
  const message = (id: string, role: string, text: string) => ({ id, role, content: { format: 2, parts: [{ type: "text", text }] }, createdAt: new Date(0) });

  test("R7: a queue failure after cloning removes the clone and reselects the source thread", async () => {
    const { rt, driver, select } = fixture();
    select("A", stateA);
    const deleted: string[] = [];
    let cloned = false;
    Object.assign(rt.threads.threadRepo, {
      recall: async () => [message("u1", "user", "hello"), message("a1", "assistant", "hi")],
      list: async () => [threadRow("A"), threadRow("B"), ...(cloned && !deleted.includes("clone") ? [threadRow("clone")] : [])],
      delete: async (id: string) => { deleted.push(id); },
    });
    rt.runs.memory.cloneThread = async () => { cloned = true; return { thread: threadRow("clone") }; };
    rt.runs.memory.deleteMessages = async () => undefined;
    driver.queue = async () => { throw new Error("project folder unavailable"); };
    await expect(rt.runs.retryReserved("a1")).rejects.toThrow("project folder unavailable");
    expect(deleted).toEqual(["clone"]);
    expect(rt.ctx.selectedThreadId).toBe("A");
    expect(rt.ctx.threadStateCache.has("clone")).toBeFalse();
  });
});

describe("review fixes: cache rollback (WAN-503)", () => {
  test("R8: a failed save of a background thread rolls back to the last saved state", async () => {
    const options = { failWrites: false };
    const { rt, select } = fixture(options);
    select("B", stateB);
    rt.ctx.threadStateCache.set("A", structuredClone(stateA));
    await rt.threads.persistThreadState("A", stateA);
    options.failWrites = true;
    const updated = rt.threads.updateThreadState("A", (state: Record<string, unknown>) => ({ ...state, events: [{ id: "e", type: "system", text: "x", createdAt: "" }] }));
    await rt.threads.persistThreadState("A", updated);
    expect(rt.ctx.threadStateCache.get("A")).toEqual(stateA);
  });
});

describe("review fixes: per-thread continuation timers (WAN-503)", () => {
  const continuationFor = (threadId: string, runId: string) => ({ interactionId: "i", toolCallId: `t-${threadId}`, threadId, runId, kind: "tool_approval", decision: "approved", phase: "resuming", startedAt: new Date().toISOString(), lastProgressAt: new Date().toISOString() });

  test("R9: finishing or arming one thread's continuation leaves another thread's timers armed", () => {
    const { rt, select } = fixture();
    select("A", stateA);
    const contA = continuationFor("A", "rA");
    const contB = continuationFor("B", "rB");
    rt.ctx.threadStateCache.set("B", { ...stateB, continuation: contB });
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    const created: unknown[] = [];
    const cleared = new Set<unknown>();
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => { const handle = realSet(...args); created.push(handle); return handle; }) as typeof setTimeout;
    globalThis.clearTimeout = ((handle: Parameters<typeof clearTimeout>[0]) => { cleared.add(handle); realClear(handle); }) as typeof clearTimeout;
    try {
      rt.continuation.armContinuationTimers(contA);
      const aTimers = [...created];
      expect(aTimers.length).toBe(2);
      rt.continuation.armContinuationTimers(contB);
      rt.continuation.finishContinuation("B", "rB", "complete");
      for (const handle of aTimers) expect(cleared.has(handle)).toBeFalse();
    } finally {
      globalThis.setTimeout = realSet;
      globalThis.clearTimeout = realClear;
      rt.continuation.clearContinuationTimers();
    }
  });
});

describe("review fixes: synthesized default state (WAN-503)", () => {
  test("R10: a metadata read error is not turned into a cached default binding", async () => {
    const { rt, select } = fixture();
    select("A", stateA);
    rt.threads.storage.getStore = async () => ({ getThreadById: async () => { throw new Error("io error"); } });
    await expect(rt.threads.loadThreadState("B")).rejects.toThrow("io error");
    expect(rt.ctx.threadStateCache.has("B")).toBeFalse();
  });

  test("R10: state synthesized for an unloaded background thread is neither cached nor persisted", async () => {
    const { rt, writes, select } = fixture();
    select("A", stateA);
    const next = rt.threads.updateThreadState("X", (state: Record<string, unknown>) => ({ ...state, events: [{ id: "e", type: "system", text: "x", createdAt: "" }] }));
    expect(rt.ctx.threadStateCache.has("X")).toBeFalse();
    await rt.threads.persistThreadState("X", next);
    expect(writes.filter((write) => write.id === "X")).toEqual([]);
  });
});

describe("Codex login handoff (WAN-503 L1)", () => {
  test("a login started after cancel keeps its own manual-input handle", async () => {
    const runtime = new TextRuntime(vault, codexStore);
    runtimes.push(runtime);
    const rt = runtime as any;
    rt.ctx.ensureInitialized = async () => undefined;
    await rt.connectProvider("codex", { mode: "browser" });
    await rt.cancelProviderAuth("codex");
    await rt.connectProvider("codex", { mode: "browser" });
    const second = rt.providers.codexManualInput;
    expect(second).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rt.providers.codexManualInput).toBe(second);
  });
});
