import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
