import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatAnswerPart, ChatMessage } from "../../shared/contracts";
import { WorkspaceRegistry } from "../workspace/workspace-registry";
import { ANSWER_INTENT_GATES } from "../tools/approval-policy";
import { AnswerIntentService, applyShownLines, STALE_FILE_MESSAGE } from "./answer-intent-service";
import { RuntimeContext } from "./context";
import type { PersistedThreadState } from "./types";

const THREAD = "t1";
const ORIGINAL = "alpha\nbeta\ngamma\n";

const blocks = [
  { type: "headline", text: "Three things" },
  { type: "list", label: "To do", rows: [
    { id: "reply", title: "Reply to Sam", act: { label: "Reply", intent: "reply", done: "Drafted" } },
    { id: "open", title: "Read the notes", sub: "notes/plan.md", act: { label: "Open", intent: "open", done: "Opened" } },
    { id: "open-out", title: "Secrets", sub: "../outside.md", act: { label: "Open", intent: "open", done: "Opened" } },
    { id: "open-none", title: "Call the bank", act: { label: "Open", intent: "open", done: "Opened" } },
    { id: "approve", title: "Book flights", act: { label: "Approve", intent: "approve", primary: true, done: "Approved" } },
    { id: "later", title: "Tidy desk", act: { label: "Not now", intent: "skip", done: "Skipped" } },
    { id: "plain", title: "No action here" },
  ] },
  { type: "choice", id: "pick", label: "Which?", options: [{ id: "a", title: "Tuesday" }, { id: "b", title: "Friday" }], confirm: { label: "Confirm", done: "Chosen" } },
  { type: "diff", id: "fix", label: "Fix beta", file: "src/a.txt", lines: [{ n: "1", text: "alpha" }, { n: "2", text: "beta", del: true }, { n: "2", text: "BETA", ins: true }, { n: "3", text: "gamma" }], act: { label: "Apply", done: "Applied", skipDone: "Skipped" } },
];

function answerMessage(over: Partial<ChatAnswerPart> = {}): ChatMessage {
  const part: ChatAnswerPart = { type: "answer", id: "m1:answer:ans1", toolCallId: "ans1", answerId: "ans1", title: "Week", question: "", blocks: blocks as never, streaming: false, outcomes: {}, confirmed: true, ...over };
  return { id: "m1", role: "assistant", text: "", turnId: "u1", parts: [part], status: "complete", createdAt: new Date(0).toISOString() };
}

let dir = "";
let root = "";
let store: Record<string, unknown>; // the "thread metadata" a reload reads back
let sent: string[];
let records: Array<Record<string, unknown>>;
let ctx: RuntimeContext;
let registry: WorkspaceRegistry;

function build() {
  ctx = new RuntimeContext();
  ctx.selectedThreadId = THREAD;
  ctx.threadState = structuredClone((store[THREAD] as PersistedThreadState | undefined) ?? { workspaceBinding: { kind: "app" } });
  ctx.publish({ messages: [answerMessage()] });
  const threads = {
    stateFor: () => ctx.threadState,
    updateThreadState: (_id: string, change: (state: PersistedThreadState) => PersistedThreadState) => (ctx.threadState = change(ctx.threadState)),
    persistThreadState: async (_id: string, state: PersistedThreadState) => { store[THREAD] = structuredClone(state); },
  };
  return new AnswerIntentService(ctx, {
    threads: threads as never,
    workspaceRegistry: registry,
    workspaces: { selectedWorkspaceRoot: async () => root },
    runs: { send: async (text: string) => { sent.push(text); return { runId: "r1" }; } },
    diagnostics: { record: (entry: never) => { records.push(entry); return null; } },
  });
}

const base = { threadId: THREAD, answerId: "ans1" };
const outcomes = () => (ctx.snapshot.messages[0]!.parts[0] as ChatAnswerPart).outcomes;
const file = () => readFile(join(root, "src/a.txt"), "utf8");

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "proteus-answer-intent-"));
  root = join(dir, "ws");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "notes"), { recursive: true });
  await writeFile(join(root, "src/a.txt"), ORIGINAL);
  await writeFile(join(root, "notes/plan.md"), "# plan\n");
  await writeFile(join(dir, "outside.md"), "secret");
  store = {};
  sent = [];
  records = [];
  registry = new WorkspaceRegistry(join(dir, "userdata"));
});
afterEach(async () => {
  await registry.destroy();
  await rm(dir, { recursive: true, force: true });
});

describe("answer intents (WAN-530)", () => {
  test("open returns a contained file for the renderer and records Opened", async () => {
    const service = build();
    expect(await service.run({ ...base, rowId: "open", intent: "open" })).toEqual({ accepted: true, outcome: "Opened", open: { path: "notes/plan.md" } });
    expect(outcomes()).toEqual({ open: "Opened" });
  });

  test("open refuses a path outside the workspace, a symlink escape, a missing file and a row citing no file", async () => {
    const service = build();
    for (const rowId of ["open-out", "open-none"]) expect(await service.run({ ...base, rowId, intent: "open" })).toMatchObject({ accepted: false });
    await symlink(dir, join(root, "link"));
    const linked = answerMessage({ blocks: [{ type: "list", label: "x", rows: [{ id: "esc", title: "Esc", sub: "link/outside.md", act: { label: "Open", intent: "open", done: "Opened" } }] }] as never });
    ctx.publish({ messages: [linked] });
    expect(await service.run({ ...base, rowId: "esc", intent: "open" })).toMatchObject({ accepted: false });
    expect(outcomes()).toEqual({});
  });

  test("reply drafts text and sends nothing", async () => {
    const service = build();
    expect(await service.run({ ...base, rowId: "reply", intent: "reply" })).toEqual({ accepted: true, outcome: "Drafted", draft: "Reply to Sam" });
    expect(sent).toEqual([]);
  });

  test("choose sends the option as the person's reply and records it", async () => {
    const service = build();
    expect(await service.run({ ...base, blockId: "pick", intent: "choose", optionId: "b" })).toEqual({ accepted: true, outcome: "Chosen · Friday" });
    expect(sent).toEqual(["Friday"]);
    expect(outcomes()).toEqual({ pick: "Chosen · Friday" });
  });

  test("skip records Not now · unchanged and writes nothing", async () => {
    const service = build();
    expect(await service.run({ ...base, blockId: "fix", intent: "skip" })).toEqual({ accepted: true, outcome: "Not now · unchanged" });
    expect(await file()).toBe(ORIGINAL);
    expect(await service.run({ ...base, rowId: "later", intent: "skip" })).toMatchObject({ accepted: true });
  });

  test("approve on a row is the person's reply to the agent: no write from the answer", async () => {
    const service = build();
    expect(await service.run({ ...base, rowId: "approve", intent: "approve" })).toEqual({ accepted: true, outcome: "Approved" });
    expect(sent).toEqual(["Approved: Book flights"]);
    expect(await file()).toBe(ORIGINAL);
  });

  test("approve on a diff applies exactly the shown lines, once", async () => {
    const service = build();
    expect(await service.run({ ...base, blockId: "fix", intent: "approve" })).toEqual({ accepted: true, outcome: "Approved" });
    expect(await file()).toBe("alpha\nBETA\ngamma\n");
    expect(records.some((entry) => entry.type === "answer.approve" && typeof (entry.payload as { fingerprint: string }).fingerprint === "string")).toBe(true);
  });

  test("a stale file fails with the runtime message and nothing is written, and the person can retry", async () => {
    const service = build();
    await writeFile(join(root, "src/a.txt"), "alpha\nbeta changed\ngamma\n");
    expect(await service.run({ ...base, blockId: "fix", intent: "approve" })).toEqual({ accepted: false, code: "stale", message: STALE_FILE_MESSAGE });
    expect(await file()).toBe("alpha\nbeta changed\ngamma\n");
    expect(outcomes()).toEqual({});
    await writeFile(join(root, "src/a.txt"), ORIGINAL);
    expect(await service.run({ ...base, blockId: "fix", intent: "approve" })).toMatchObject({ accepted: true });
  });

  test("a diff against a file that moves between read and write is refused by the version check", async () => {
    const service = build();
    const real = registry.write.bind(registry);
    registry.write = (async (...args: Parameters<typeof real>) => {
      await writeFile(join(root, "src/a.txt"), "someone else\n");
      return real(...args);
    }) as never;
    const result = await service.run({ ...base, blockId: "fix", intent: "approve" });
    expect(result).toMatchObject({ accepted: false, code: "stale" });
    expect(await file()).toBe("someone else\n");
  });

  test("a diff cannot reach outside the workspace", async () => {
    const service = build();
    const escaping = answerMessage({ blocks: [{ type: "diff", id: "esc", label: "x", file: "../outside.md", lines: [{ n: "1", text: "secret", del: true }, { n: "1", text: "changed", ins: true }], act: { label: "Apply", done: "Applied", skipDone: "Skipped" } }] as never });
    ctx.publish({ messages: [escaping] });
    expect(await service.run({ ...base, blockId: "esc", intent: "approve" })).toMatchObject({ accepted: false });
    expect(await readFile(join(dir, "outside.md"), "utf8")).toBe("secret");
  });

  test("a diff whose file only looks contained (traversal, dot segments, .git) writes nothing and records nothing", async () => {
    const service = build();
    await mkdir(join(root, "docs/plan.md"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(join(root, ".git/config"), "[core]\n");
    const insert = (file: string) => answerMessage({ blocks: [{ type: "diff", id: "esc", label: "x", file, lines: [{ n: "2", text: "[evil]", ins: true }], act: { label: "Apply", done: "Applied", skipDone: "Skipped" } }] as never });
    for (const file of ["docs/plan.md/x/../x/../x/../../../.git/config", ".git/config", "src/../.git/config", "src/./a.txt", "src//a.txt", "src\\a.txt", "/etc/hosts", "sub/.git/config"]) {
      ctx.publish({ messages: [insert(file)] });
      expect(await service.run({ ...base, blockId: "esc", intent: "approve" })).toMatchObject({ accepted: false, code: "refused" });
    }
    expect(await readFile(join(root, ".git/config"), "utf8")).toBe("[core]\n");
    expect(outcomes()).toEqual({});
  });

  test("an answer is not actionable without a confirmed (shown) result, or when its composition is broken", async () => {
    const service = build();
    ctx.publish({ messages: [answerMessage({ confirmed: undefined })] });
    expect(await service.run({ ...base, blockId: "pick", intent: "choose", optionId: "a" })).toMatchObject({ accepted: false, code: "refused" });
    const twoChoices = [...blocks, blocks[2]!] as never;
    ctx.publish({ messages: [answerMessage({ blocks: twoChoices })] });
    expect(await service.run({ ...base, blockId: "fix", intent: "approve" })).toMatchObject({ accepted: false, code: "refused" });
    expect(sent).toEqual([]);
    expect(await file()).toBe(ORIGINAL);
    expect(outcomes()).toEqual({});
  });

  test("anything not on the allowlist is refused and records nothing", async () => {
    const service = build();
    const refused = [
      { rowId: "plain", intent: "approve" }, // a row without an action
      { rowId: "reply", intent: "approve" }, // an intent the row does not offer
      { rowId: "open", intent: "reply" },
      { rowId: "nope", intent: "open" },
      { blockId: "pick", intent: "approve" },
      { blockId: "pick", intent: "choose", optionId: "zzz" }, // option not in the answer
      { blockId: "pick", intent: "skip" },
      { blockId: "fix", intent: "open" },
      { blockId: "fix", intent: "choose", optionId: "a" },
      { blockId: "missing", intent: "approve" },
      { intent: "approve" },
      { rowId: "approve", intent: "delete" },
      { rowId: "approve", intent: "approve", command: "rm -rf /" }, // unknown field
    ] as const;
    for (const extra of refused) expect(await service.run({ ...base, ...extra } as never)).toMatchObject({ accepted: false, code: "refused" });
    expect(await service.run({ ...base, threadId: "other", rowId: "reply", intent: "reply" })).toMatchObject({ accepted: false });
    expect(await service.run({ ...base, answerId: "nope", rowId: "reply", intent: "reply" })).toMatchObject({ accepted: false });
    expect(sent).toEqual([]);
    expect(await file()).toBe(ORIGINAL);
    expect(outcomes()).toEqual({});
  });

  test("an answer still streaming, or a block that failed validation, offers nothing", async () => {
    const service = build();
    ctx.publish({ messages: [answerMessage({ streaming: true })] });
    expect(await service.run({ ...base, rowId: "reply", intent: "reply" })).toMatchObject({ accepted: false });
    ctx.publish({ messages: [answerMessage({ blocks: [{ type: "fallback" }] })] });
    expect(await service.run({ ...base, blockId: "fix", intent: "approve" })).toMatchObject({ accepted: false });
  });

  test("double fire runs once, even concurrently", async () => {
    const service = build();
    const [one, two] = await Promise.all([
      service.run({ ...base, blockId: "pick", intent: "choose", optionId: "a" }),
      service.run({ ...base, blockId: "pick", intent: "choose", optionId: "a" }),
    ]);
    expect([one.accepted, two.accepted].sort()).toEqual([false, true]);
    const again = await service.run({ ...base, blockId: "pick", intent: "choose", optionId: "b" });
    expect(again).toMatchObject({ accepted: false, code: "already-done" });
    expect(sent).toEqual(["Tuesday"]);

    await service.run({ ...base, blockId: "fix", intent: "approve" });
    expect(await service.run({ ...base, blockId: "fix", intent: "approve" })).toMatchObject({ accepted: false, code: "already-done" });
    expect(await service.run({ ...base, blockId: "fix", intent: "skip" })).toMatchObject({ accepted: false, code: "already-done" });
    expect(await file()).toBe("alpha\nBETA\ngamma\n");
  });

  test("outcomes survive a reload: a new runtime reads them back and refuses a second run", async () => {
    await build().run({ ...base, blockId: "fix", intent: "approve" });
    await build().run({ ...base, rowId: "reply", intent: "reply" });
    // Reload: fresh context and service, state read back from the stored metadata, messages projected again.
    const reloaded = build();
    expect(outcomes()).toEqual({ fix: "Approved", reply: "Drafted" });
    expect(await reloaded.run({ ...base, blockId: "fix", intent: "approve" })).toMatchObject({ accepted: false, code: "already-done" });
  });

  test("a failing send leaves the choice open to retry", async () => {
    const service = build();
    (service as never as { deps: { runs: { send(): Promise<never> } } }).deps.runs.send = async () => { throw new Error("busy"); };
    expect(await service.run({ ...base, blockId: "pick", intent: "choose", optionId: "a" })).toMatchObject({ accepted: false, code: "failed" });
    expect(outcomes()).toEqual({});
  });

  test("only approve can reach a write", () => {
    expect(Object.entries(ANSWER_INTENT_GATES).filter(([, gate]) => gate === "explicit-approval").map(([intent]) => intent)).toEqual(["approve"]);
  });
});

describe("applyShownLines", () => {
  const lines = [{ n: "2", text: "beta", del: true }, { n: "2", text: "BETA", ins: true }];
  test("replaces at the shown line and nowhere else", () => {
    expect(applyShownLines("alpha\nbeta\nbeta\n", lines)).toBe("alpha\nBETA\nbeta\n");
  });
  test("without line numbers it needs exactly one match", () => {
    const bare = [{ text: "beta", del: true }, { text: "BETA", ins: true }];
    expect(applyShownLines("alpha\nbeta\n", bare)).toBe("alpha\nBETA\n");
    expect(applyShownLines("beta\nbeta\n", bare)).toBeNull();
    expect(applyShownLines("alpha\n", bare)).toBeNull();
  });
  test("a pure insertion needs its number", () => {
    expect(applyShownLines("a\nb", [{ n: "2", text: "x", ins: true }])).toBe("a\nx\nb");
    expect(applyShownLines("a\nb", [{ text: "x", ins: true }])).toBeNull();
  });
});
