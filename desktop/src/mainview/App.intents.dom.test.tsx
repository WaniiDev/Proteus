import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { buildFixture } from "../../preview/fixtures";
import type { AnswerIntentParams, AnswerIntentResult, RuntimeSnapshot } from "../shared/contracts";
import { encodeRuntimeSnapshot } from "../shared/runtime-snapshot-codec";
import { useDom } from "./test/dom";

useDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame ??= (fn: () => void) => setTimeout(fn, 0);

let state: RuntimeSnapshot;
let listener: ((payload: unknown) => void) | undefined;
const calls: Array<{ name: string; params: unknown }> = [];
let intentReply: (params: AnswerIntentParams) => Promise<AnswerIntentResult> = async () => ({ accepted: true, outcome: "Approved" });
const intentCalls = () => calls.filter((call) => call.name === "chat.answer.intent").map((call) => call.params as AnswerIntentParams);

mock.module("./lib/bridge", () => ({
  rpc: {
    addMessageListener: (_name: string, fn: (payload: unknown) => void) => { listener = fn; },
    removeMessageListener: () => { listener = undefined; },
    request: new Proxy({}, { get: (_target, name: string) => async (params?: unknown) => {
      calls.push({ name, params });
      if (name === "runtime.bootstrap") return encodeRuntimeSnapshot(state);
      if (name === "chat.answer.intent") return intentReply(params as AnswerIntentParams);
      if (name === "workspace.tree") return [];
      if (name === "workspace.read") return { path: (params as { path: string }).path, kind: "text", content: "hello", version: "v1", size: 5, modifiedAt: "2026-08-01T00:00:00.000Z" };
      return { accepted: true };
    } }),
  },
}));
const { default: App } = await import("./App");

const blocks = [
  { type: "list", label: "To do", rows: [
    { id: "r1", title: "Reply to the vendor", act: { label: "Draft reply", intent: "reply", done: "Drafted" } },
    { id: "r2", title: "Plan notes", sub: "notes/plan.md", act: { label: "Open", intent: "open", done: "Opened" } },
    { id: "r3", title: "Send the invoice", act: { label: "Approve", intent: "approve", done: "Approved" } },
  ] },
  { type: "choice", id: "c1", label: "Which plan?", options: [{ id: "o1", title: "Annual" }, { id: "o2", title: "Monthly" }], confirm: { label: "Choose", done: "Chosen" } },
  { type: "diff", id: "d1", label: "Proposed edit", file: "docs/plan.md", lines: [{ n: "1", text: "old", del: true }, { n: "1", text: "new", ins: true }], act: { label: "Approve", done: "Approved · edited", skipDone: "Not now · unchanged" } },
  { type: "suggest", items: ["Show next week"] },
];

function withAnswer(outcomes: Record<string, string> = {}, revision = 1): RuntimeSnapshot {
  const base = buildFixture("answer");
  const messages = base.messages.filter((m) => m.id !== "m3" && m.id !== "m4").map((m) => ({
    ...m, turnId: m.role === "assistant" ? "turn-1" : m.turnId, parts: m.parts.map((p) => (p.type === "answer" ? { ...p, blocks: blocks as never, outcomes } : p)),
  }));
  return { ...base, revision, status: "ready", activeRun: null, messages } as RuntimeSnapshot;
}

let root: Root | undefined;
let host: HTMLElement;
const wait = (ms = 0) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
beforeEach(async () => {
  calls.length = 0;
  state = withAnswer();
  intentReply = async () => ({ accepted: true, outcome: "Approved" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<App />));
  await wait(20);
});
afterEach(async () => { await act(async () => root?.unmount()); document.body.innerHTML = ""; });

const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
const btn = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const input = () => document.querySelector<HTMLTextAreaElement | HTMLInputElement>(".island-input")!;

describe("answer intents in the app", () => {
  test("each intent sends the runtime its ids: rows send rowId, choice and diff send blockId", async () => {
    await click(btn("Draft reply: Reply to the vendor")); await wait();
    await click(btn("Open: Plan notes")); await wait();
    await click(btn("Approve: Send the invoice")); await wait();
    await click(host.querySelector('[role="radio"]:nth-of-type(2)'));
    await click(btn("Choose: Monthly")); await wait();
    await click(btn("Not now: leave docs/plan.md unchanged")); await wait();
    await click(btn("Approve the edit to docs/plan.md")); await wait();
    expect(intentCalls()).toEqual([
      { threadId: "th1", answerId: "a1", rowId: "r1", intent: "reply" },
      { threadId: "th1", answerId: "a1", rowId: "r2", intent: "open" },
      { threadId: "th1", answerId: "a1", rowId: "r3", intent: "approve" },
      { threadId: "th1", answerId: "a1", blockId: "c1", intent: "choose", optionId: "o2" },
      { threadId: "th1", answerId: "a1", blockId: "d1", intent: "skip" },
      { threadId: "th1", answerId: "a1", blockId: "d1", intent: "approve" },
    ]);
  });

  test("open shows the file in the Files dialog and reply puts the draft in the Island input", async () => {
    intentReply = async (params) => params.intent === "open" ? { accepted: true, outcome: "Opened", open: { path: "notes/plan.md" } } : { accepted: true, outcome: "Drafted", draft: "Reply to the vendor" };
    await click(btn("Open: Plan notes")); await wait(20);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Files in this conversation");
    expect(calls.some((call) => call.name === "workspace.read" && (call.params as { path: string }).path === "notes/plan.md")).toBe(true);
    await click(Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] button')).find((b) => b.textContent === "Close") ?? null);
    await wait(250);
    await click(btn("Draft reply: Reply to the vendor")); await wait();
    expect(input().value).toBe("Reply to the vendor");
    expect(calls.some((call) => call.name === "chat.send")).toBe(false);
  });

  test("a double click sends once and the action shows it is pending", async () => {
    let finish!: (result: AnswerIntentResult) => void;
    intentReply = () => new Promise((resolve) => { finish = resolve; });
    const button = btn("Approve: Send the invoice");
    await click(button); await click(button);
    expect(intentCalls()).toHaveLength(1);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector(".gen-act-spin")).not.toBeNull();
    await act(async () => finish({ accepted: true, outcome: "Approved" }));
    expect(btn("Approve: Send the invoice").disabled).toBe(false);
  });

  test("a failure shows the runtime's message as the row's note and keeps the action enabled", async () => {
    intentReply = async () => ({ accepted: false, code: "stale", message: "File changed outside Proteus; refresh before saving" });
    await click(btn("Approve the edit to docs/plan.md")); await wait();
    const note = host.querySelector(".gen-diff-foot .field-error");
    expect(note?.textContent).toBe("File changed outside Proteus; refresh before saving");
    expect(note?.getAttribute("role")).toBe("alert");
    expect(btn("Approve the edit to docs/plan.md").disabled).toBe(false);
    intentReply = async () => ({ accepted: true, outcome: "Approved · edited" });
    await click(btn("Approve the edit to docs/plan.md")); await wait();
    expect(intentCalls()).toHaveLength(2);
    expect(host.querySelector(".gen-diff-foot .field-error")).toBeNull();
  });

  test("a transport failure shows a note too, and the outcome from the snapshot replaces the action in past tense", async () => {
    intentReply = async () => { throw new Error("boom"); };
    await click(btn("Approve: Send the invoice")); await wait();
    expect(host.textContent).toContain("That action could not be sent. Try again.");
    state = withAnswer({ r3: "Approved" }, 2);
    await act(async () => { listener?.(encodeRuntimeSnapshot(state)); });
    await wait();
    expect(host.querySelector('[aria-label="Approve: Send the invoice"]')).toBeNull();
    expect(host.querySelector(".gen-row.is-done .gen-done")?.textContent).toBe("Approved");
    expect(host.textContent).not.toContain("That action could not be sent");
  });

  test("a follow-up chip sends its text as a new message", async () => {
    await click(host.querySelector(".gen-chip")); await wait();
    const sent = calls.find((call) => call.name === "chat.send")!.params as { text: string };
    expect(sent.text).toBe("Show next week");
  });
});
