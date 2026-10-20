import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import type { ChatAnswerPart, ChatMessage } from "../../shared/contracts";
import { scriptedStreamingModel, waitFor } from "../native/native-mastra-test-harness";
import { createShowAnswerTool } from "../tools/show-answer-tool";
import { WorkspaceRegistry } from "../workspace/workspace-registry";
import { AnswerIntentService, STALE_FILE_MESSAGE } from "./answer-intent-service";
import { RuntimeContext } from "./context";
import { applyAnswerOutcomes, projectMessageParts } from "./message-mapping";
import type { PersistedThreadState } from "./types";

// The runtime is a per-process singleton over Electrobun paths; give it a throwaway user-data directory.
let userData = "";
let TextRuntime: typeof import("../runtime").TextRuntime;
const runtimes: Array<{ shutdown(): Promise<void> }> = [];

beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "proteus-answer-intent-rt-"));
  mock.module("electrobun/bun", () => ({
    Utils: { paths: { userData }, openExternal: () => undefined, openPath: () => undefined, openFileDialog: async () => [] },
  }));
  ({ TextRuntime } = await import("../runtime"));
}, 60_000);
afterEach(async () => { for (const runtime of runtimes.splice(0)) await runtime.shutdown().catch(() => undefined); });
afterAll(async () => { await rm(userData, { recursive: true, force: true }).catch(() => undefined); });

const vault = { get: async () => null, set: async () => undefined, delete: async () => undefined };
const codexStore = { setOAuth: () => undefined, clear: () => undefined } as never;

const input = { v: 2, title: "Pick", blocks: [
  { type: "headline", text: "One choice" },
  { type: "choice", id: "pick", label: "Which?", options: [{ id: "a", title: "Tuesday" }, { id: "b", title: "Friday" }], confirm: { label: "Confirm", done: "Chosen" } },
] };
const raw = [
  { id: "u1", role: "user", createdAt: new Date(1), content: { format: 2, parts: [{ type: "text", text: "When?" }] } },
  { id: "a1", role: "assistant", createdAt: new Date(2), content: { format: 2, parts: [{ type: "tool-invocation", toolInvocation: { state: "result", toolCallId: "c1", toolName: "show_answer", args: input, result: { ok: true, shown: true } } }] } },
];

/** A runtime whose Mastra boundary is faked: stored metadata is a map, messages come from `raw`. */
function fixture(metadata: Record<string, unknown>) {
  const runtime = new TextRuntime(vault, codexStore);
  runtimes.push(runtime);
  const rt = runtime as any;
  const writes: Array<Record<string, unknown>> = [];
  const memoryStore = {
    getThreadById: async ({ threadId }: { threadId: string }) => ({ id: threadId, title: threadId, metadata }),
    updateThread: async ({ metadata: next }: { metadata: Record<string, unknown> }) => { writes.push(next); Object.assign(metadata, next); },
  };
  rt.threads.storage.getStore = async (name: string) => (name === "memory" ? memoryStore : undefined);
  rt.workspaces.requestContextFor = async () => ({ get: () => undefined });
  rt.threads.projects.list = async () => [];
  const row = { id: "T", title: "T", createdAt: new Date(0), updatedAt: new Date(0), metadata };
  Object.assign(rt.threads.threadRepo, { get: async () => row, list: async () => [row], recall: async () => raw, create: async () => row });
  const driver = { listSuspensions: async () => [] as unknown[], queuedCount: () => 0, ensureSubscription: async () => undefined, dispose: () => undefined, activeRunId: () => null as string | null, queue: async () => ({ runId: "r1", queued: true }) };
  for (const key of Object.keys(driver)) Object.defineProperty(rt.threads.nativeDriver, key, { configurable: true, get: () => (driver as Record<string, unknown>)[key] });
  rt.ctx.ensureInitialized = async () => undefined;
  rt.runs.send = async () => ({ runId: "r1" });
  return { runtime, rt, writes };
}

test("chat.answer.intent through the runtime facade persists the outcome with the thread and a reload shows it", async () => {
  const metadata: Record<string, unknown> = {};
  const first = fixture(metadata);
  await first.rt.threads.selectThread("T");
  const answerPart = () => first.rt.ctx.snapshot.messages.flatMap((message: any) => message.parts).find((part: any) => part.type === "answer");
  expect(answerPart()?.answerId).toBe("c1");
  expect(answerPart()?.outcomes).toEqual({});

  const result = await first.runtime.runAnswerIntent({ threadId: "T", answerId: "c1", blockId: "pick", intent: "choose", optionId: "b" });
  expect(result).toEqual({ accepted: true, outcome: "Chosen · Friday" });
  expect(answerPart()?.outcomes).toEqual({ pick: "Chosen · Friday" });
  expect(JSON.stringify(first.writes)).toContain("Chosen · Friday");
  expect(await first.runtime.runAnswerIntent({ threadId: "T", answerId: "c1", blockId: "pick", intent: "choose", optionId: "a" })).toMatchObject({ accepted: false, code: "already-done" });

  // Reload: a fresh runtime reading the stored thread metadata.
  const second = fixture(metadata);
  await second.rt.threads.selectThread("T");
  const reloaded = second.rt.ctx.snapshot.messages.flatMap((message: any) => message.parts).find((part: any) => part.type === "answer");
  expect(reloaded?.outcomes).toEqual({ pick: "Chosen · Friday" });
  expect(await second.runtime.runAnswerIntent({ threadId: "T", answerId: "c1", blockId: "pick", intent: "choose", optionId: "a" })).toMatchObject({ accepted: false, code: "already-done" });
});

describe("answer intents end to end (Mastra harness, WAN-530)", () => {
  const ORIGINAL = "alpha\nbeta\ngamma\n";
  const answerInput = { v: 2, title: "Week", blocks: [
    { type: "headline", text: "Three things" },
    { type: "list", label: "To do", rows: [
      { id: "reply", title: "Reply to Sam", act: { label: "Reply", intent: "reply", done: "Drafted" } },
      { id: "open", title: "Read the notes", sub: "notes/plan.md", act: { label: "Open", intent: "open", done: "Opened" } },
      { id: "book", title: "Book flights", act: { label: "Approve", intent: "approve", primary: true, done: "Approved" } },
      { id: "later", title: "Tidy desk", act: { label: "Not now", intent: "skip", done: "Skipped" } },
    ] },
    { type: "choice", id: "pick", label: "Which day?", options: [{ id: "a", title: "Tuesday" }, { id: "b", title: "Friday" }], confirm: { label: "Confirm", done: "Chosen" } },
    { type: "diff", id: "fix", label: "Fix beta", file: "src/a.txt", lines: [{ n: "1", text: "alpha" }, { n: "2", text: "beta", del: true }, { n: "2", text: "BETA", ins: true }, { n: "3", text: "gamma" }], act: { label: "Apply", done: "Applied", skipDone: "Skipped" } },
  ] };

  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => { for (const clean of cleanups.splice(0)) await clean().catch(() => undefined); });

  async function harness() {
    const dir = await mkdtemp(join(tmpdir(), "proteus-answer-e2e-"));
    const root = join(dir, "ws");
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(join(root, "src/a.txt"), ORIGINAL);
    await writeFile(join(root, "notes/plan.md"), "# plan\n");
    const storage = new LibSQLStore({ id: `answer-e2e-${crypto.randomUUID()}`, url: `file:${join(dir, "mastra.db")}` });
    const memory = new Memory({ storage });
    const agent = new Agent({
      id: `answer-e2e-agent-${crypto.randomUUID()}`,
      name: "Answer intents",
      instructions: "Answer with show_answer when useful.",
      model: scriptedStreamingModel([{ type: "tool", toolName: "show_answer", input: answerInput }, { type: "text", text: "Here you go." }]),
      memory,
      tools: { show_answer: createShowAnswerTool() },
    });
    const mastra = new Mastra({ storage, agents: { test: agent }, logger: false });
    const registry = new WorkspaceRegistry(join(dir, "userdata"));
    cleanups.push(async () => { await mastra.shutdown(); await registry.destroy(); await rm(dir, { recursive: true, force: true }); });
    const resourceId = "user";
    const threadId = `thread-${crypto.randomUUID()}`;
    const chunks: Array<{ type: string }> = [];
    const subscription = await agent.subscribeToThread({ resourceId, threadId });
    void (async () => { for await (const chunk of subscription.stream) chunks.push(chunk as never); })();
    const finished = () => chunks.filter((chunk) => chunk.type === "finish").length;
    /** The real send path of the harness: a user message queued on the thread, run by the Mastra agent. */
    const send = async (text: string) => {
      const before = finished();
      const queued = agent.queueMessage({ contents: text, metadata: { clientMessageId: crypto.randomUUID() } }, { resourceId, threadId });
      const accepted = await queued.accepted;
      if (accepted.action === "wake") void accepted.output.consumeStream();
      await waitFor(`run to finish for "${text}"`, () => (finished() > before || chunks.some((chunk) => chunk.type === "error") ? true : undefined), 15_000);
      return { runId: queued.signal.id };
    };
    const recalled = async () => (await memory.recall({ threadId, perPage: false })).messages;
    return { dir, root, registry, send, recalled, threadId };
  }

  /** What the app shows after a reload: the stored messages mapped to snapshot messages, with recorded outcomes merged in. */
  async function messagesFrom(recalled: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["recalled"]>>, store: Record<string, PersistedThreadState>, threadId: string): Promise<ChatMessage[]> {
    const mapped = recalled.map((message) => ({ id: message.id, role: message.role === "user" ? "user" : "assistant", text: "", turnId: "t", parts: projectMessageParts(message as never), status: "complete", createdAt: new Date(0).toISOString() }) as ChatMessage);
    return JSON.parse(JSON.stringify(applyAnswerOutcomes(mapped, store[threadId]?.answerOutcomes))) as ChatMessage[];
  }

  function service(h: Awaited<ReturnType<typeof harness>>, messages: ChatMessage[], store: Record<string, PersistedThreadState>, sends: string[]) {
    const ctx = new RuntimeContext();
    ctx.selectedThreadId = h.threadId;
    ctx.threadState = structuredClone(store[h.threadId] ?? { workspaceBinding: { kind: "app" } }) as PersistedThreadState;
    ctx.publish({ messages });
    const threads = {
      stateFor: () => ctx.threadState,
      updateThreadState: (_id: string, change: (state: PersistedThreadState) => PersistedThreadState) => (ctx.threadState = change(ctx.threadState)),
      persistThreadState: async (_id: string, state: PersistedThreadState) => { store[h.threadId] = structuredClone(state); },
    };
    const svc = new AnswerIntentService(ctx, {
      threads: threads as never,
      workspaceRegistry: h.registry,
      workspaces: { selectedWorkspaceRoot: async () => h.root },
      runs: { send: async (text: string) => { sends.push(text); return h.send(text); } },
      diagnostics: { record: () => null },
    });
    const outcomes = () => (ctx.snapshot.messages.flatMap((message) => message.parts).find((part): part is ChatAnswerPart => part.type === "answer"))?.outcomes;
    return { svc, ctx, outcomes };
  }

  /** Everything the person said into the thread (queued messages are stored as signals, not user rows). */
  const userTexts = async (h: Awaited<ReturnType<typeof harness>>) => (await h.recalled()).filter((m) => m.role !== "assistant").map((m) => JSON.stringify(m.content));

  async function ready() {
    const h = await harness();
    await h.send("What does my week look like?");
    const store: Record<string, PersistedThreadState> = {};
    const messages = await messagesFrom(await h.recalled(), store, h.threadId);
    const answer = messages.flatMap((m) => m.parts).find((part): part is ChatAnswerPart => part.type === "answer");
    expect(answer).toMatchObject({ confirmed: true, streaming: false });
    expect(typeof answer?.answerId).toBe("string");
    const sends: string[] = [];
    return { h, store, sends, answerId: answer!.answerId, ...service(h, messages, store, sends) };
  }

  test("open, reply and skip act on the stored answer and send nothing", async () => {
    const t = await ready();
    const base = { threadId: t.h.threadId, answerId: t.answerId };
    expect(await t.svc.run({ ...base, rowId: "open", intent: "open" })).toEqual({ accepted: true, outcome: "Opened", open: { path: "notes/plan.md" } });
    expect(await t.svc.run({ ...base, rowId: "reply", intent: "reply" })).toEqual({ accepted: true, outcome: "Drafted", draft: "Reply to Sam" });
    expect(await t.svc.run({ ...base, rowId: "later", intent: "skip" })).toEqual({ accepted: true, outcome: "Not now · unchanged" });
    expect(t.sends).toEqual([]);
    expect(t.outcomes()).toEqual({ open: "Opened", reply: "Drafted", later: "Not now · unchanged" });
  }, 30_000);

  test("approve on a row and choose become the person's reply in the thread", async () => {
    const t = await ready();
    const base = { threadId: t.h.threadId, answerId: t.answerId };
    expect(await t.svc.run({ ...base, rowId: "book", intent: "approve" })).toEqual({ accepted: true, outcome: "Approved" });
    expect(await t.svc.run({ ...base, blockId: "pick", intent: "choose", optionId: "b" })).toEqual({ accepted: true, outcome: "Chosen · Friday" });
    expect(t.sends).toEqual(["Approved: Book flights", "Friday"]);
    const stored = await userTexts(t.h);
    expect(stored.some((text) => text.includes("Approved: Book flights"))).toBe(true);
    expect(stored.some((text) => text.includes("Friday"))).toBe(true);
    expect(await readFile(join(t.h.root, "src/a.txt"), "utf8")).toBe(ORIGINAL);
  }, 30_000);

  test("approve on the diff writes the shown lines to the workspace file; once only", async () => {
    const t = await ready();
    const base = { threadId: t.h.threadId, answerId: t.answerId };
    expect(await t.svc.run({ ...base, blockId: "fix", intent: "approve" })).toEqual({ accepted: true, outcome: "Approved" });
    expect(await readFile(join(t.h.root, "src/a.txt"), "utf8")).toBe("alpha\nBETA\ngamma\n");
    expect(await t.svc.run({ ...base, blockId: "fix", intent: "approve" })).toMatchObject({ accepted: false, code: "already-done" });
  }, 30_000);

  test("a diff approved after the file moved on is refused as stale and writes nothing", async () => {
    const t = await ready();
    await writeFile(join(t.h.root, "src/a.txt"), "alpha\nsomeone edited\ngamma\n");
    expect(await t.svc.run({ threadId: t.h.threadId, answerId: t.answerId, blockId: "fix", intent: "approve" })).toEqual({ accepted: false, code: "stale", message: STALE_FILE_MESSAGE });
    expect(await readFile(join(t.h.root, "src/a.txt"), "utf8")).toBe("alpha\nsomeone edited\ngamma\n");
    expect(t.outcomes()).toEqual({});
  }, 30_000);

  test("after a reload from the stored thread every acted target stays done and nothing runs twice", async () => {
    const t = await ready();
    const base = { threadId: t.h.threadId, answerId: t.answerId };
    await t.svc.run({ ...base, blockId: "pick", intent: "choose", optionId: "a" });
    await t.svc.run({ ...base, blockId: "fix", intent: "approve" });
    const reloaded = service(t.h, await messagesFrom(await t.h.recalled(), t.store, t.h.threadId), t.store, t.sends);
    expect(reloaded.outcomes()).toEqual({ pick: "Chosen · Tuesday", fix: "Approved" });
    expect(await reloaded.svc.run({ ...base, blockId: "pick", intent: "choose", optionId: "b" })).toMatchObject({ accepted: false, code: "already-done" });
    expect(await reloaded.svc.run({ ...base, blockId: "fix", intent: "approve" })).toMatchObject({ accepted: false, code: "already-done" });
    expect(t.sends).toEqual(["Tuesday"]);
    expect(await readFile(join(t.h.root, "src/a.txt"), "utf8")).toBe("alpha\nBETA\ngamma\n");
    // Untouched targets are still available after the reload.
    expect(await reloaded.svc.run({ ...base, rowId: "reply", intent: "reply" })).toMatchObject({ accepted: true });
  }, 30_000);
});
