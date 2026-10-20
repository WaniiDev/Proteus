import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { buildFixture } from "../../../preview/fixtures";
import type { RuntimeSnapshot } from "../../shared/contracts";
import { useDom } from "../test/dom";

// The Electrobun bridge does not load under bun test.
mock.module("../lib/bridge", () => ({ rpc: { request: new Proxy({}, { get: () => async () => ({ accepted: true }) }) } }));
const { Companion } = await import("./Companion");

useDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The orb canvas is not available here.
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame ??= (fn: () => void) => setTimeout(fn, 0);

const noop = () => undefined;
const ok = async () => ({ accepted: true as const });
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.innerHTML = ""; });

async function mount(snapshot: RuntimeSnapshot, extra: Record<string, unknown> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const props = () => ({
    snapshot, activeTitle: "Chat", input: "", setInput: noop, queuedDrafts: [], transportError: null, onTransportRetry: noop, onSend: (event: { preventDefault: () => void }) => event.preventDefault(), onAbort: noop, onSettings: noop,
    onOrbState: noop, onRetry: noop, onContinue: noop, onInteraction: ok, onInteractionDismiss: ok, onToolApproval: ok, ...extra,
  });
  const render = (next: RuntimeSnapshot = snapshot) => { snapshot = next; return act(async () => root!.render(<Companion {...(props() as unknown as ComponentProps<typeof Companion>)} />)); };
  await render();
  return { host, render, q: <T extends Element>(s: string) => host.querySelector<T>(s), thread: () => host.querySelector(".thread")! };
}

describe("asks in the Island", () => {
  test("one ask at a time with its place in the queue, and nothing ask-related in the thread", async () => {
    const t = await mount(buildFixture("ask"));
    expect(t.q(".island")!.classList.contains("is-open")).toBe(true);
    expect(t.q(".island-title")!.textContent).toBe("Edit src/index.test.ts");
    expect(t.host.querySelectorAll(".island-title")).toHaveLength(1);
    expect(t.q(".island-kicker")!.textContent).toBe("Needs you · Edit file · 1 of 2");
    expect(t.thread().querySelector(".interaction-card, .island-actions, .island-title, [data-ask-variant]")).toBeNull();
    expect(t.thread().textContent).not.toContain("Approve");
    expect(t.thread().textContent).not.toContain("Which environment");
  });

  test("the next ask takes the Island once the first is answered", async () => {
    const snapshot = buildFixture("ask");
    const t = await mount(snapshot);
    const [, second] = snapshot.interactions;
    await t.render({ ...snapshot, interactions: [second!] });
    expect(t.q(".island-title")!.textContent).toBe("A question from Proteus");
    expect(t.q(".island-kicker")!.textContent).toBe("Needs you · Question");
    await t.render({ ...snapshot, interactions: [] });
    expect(t.q(".island")!.classList.contains("is-open")).toBe(false);
  });

  test("approving from the Island sends the fingerprint the snapshot carries", async () => {
    const calls: unknown[][] = [];
    const t = await mount(buildFixture("ask"), { onToolApproval: async (...args: unknown[]) => { calls.push(args); return { accepted: true }; } });
    await act(async () => { [...t.host.querySelectorAll<HTMLButtonElement>(".island-actions button")][1]!.click(); });
    expect(calls).toEqual([["t3", true, "fp-1"]]);
  });

  test("answered asks leave one resolved line in the thread", async () => {
    const snapshot = buildFixture("ask");
    const message = snapshot.messages[1]!;
    const t = await mount({ ...snapshot, interactions: [], messages: [snapshot.messages[0]!, { ...message, status: "complete", parts: [{ type: "tool", id: "x", toolCallId: "t3", name: "mastra_workspace_edit_file", label: "Edit", status: "declined", input: { path: "docs/plan.md" } }] }] });
    const lines = [...t.thread().querySelectorAll(".resolved")].map((line) => line.textContent);
    expect(lines).toEqual(["Declined · Edit docs/plan.md"]);
  });
});

describe("one live region", () => {
  // The Copy button's own "Copied" confirmation is the one other announcement, and sits on a button.
  const regions = (host: HTMLElement) => [...host.querySelectorAll('[aria-live], [role="status"], [role="alert"]')].filter((el) => !el.closest(".island") && !el.closest("button"));

  test("the Island is the only live region, with a thread, steps, a continuation notice and an ask on screen", async () => {
    const snapshot = buildFixture("ask");
    const withSteps = { ...snapshot, messages: snapshot.messages.map((message) => (message.role === "assistant" ? { ...message, parts: [{ type: "tool" as const, id: "r", toolCallId: "r", name: "mastra_workspace_read_file", label: "Read", status: "completed" as const, input: { path: "a.md" } }, ...message.parts] } : message)) };
    const t = await mount({ ...withSteps, continuation: { threadId: snapshot.activeThreadId!, toolCallId: "t3", phase: "slow" } as never });
    expect(t.host.querySelector(".continuation-notice")).toBeTruthy();
    expect(t.host.querySelector(".steps")).toBeTruthy();
    expect(t.host.querySelectorAll(".island > [aria-live]:not(.island-body)")).toHaveLength(1);
    expect(t.host.querySelector(".island-body")!.getAttribute("aria-live")).toBe("off");
    expect(regions(t.host)).toEqual([]);
  });

  test("Stop fades out while an ask is open; the ask answers from its body", async () => {
    const t = await mount(buildFixture("ask"));
    const on = [...t.host.querySelectorAll(".island-end > [data-on='true']")].map((el) => el.textContent);
    expect(on).toEqual([]);
  });
});

describe("answers in the Island", () => {
  const streaming = () => buildFixture("answer");
  const settled = () => {
    const snapshot = buildFixture("answer");
    const last = snapshot.messages.at(-1)!;
    return { ...snapshot, activeRun: null, messages: [...snapshot.messages.slice(0, -1), { ...last, status: "complete" as const, parts: last.parts.map((part) => (part.type === "answer" ? { ...part, streaming: false, blocks: [...part.blocks, { type: "suggest" as const, items: ["Show Friday"] }] } : part)) }] };
  };

  test("the latest answer opens the Island while it streams: Speaking, the question, Done, and no card yet", async () => {
    const t = await mount(streaming());
    const island = t.q(".island")!;
    expect(island.classList.contains("is-open")).toBe(true);
    expect(t.q(".island-body-inner")!.classList.contains("gen-scroll")).toBe(true);
    expect(t.q(".island-body .gen")).toBeTruthy();
    expect(t.q(".island-body .gen-more")).toBeTruthy();
    const status = [...t.host.querySelectorAll(".island-status")].find((el) => el.getAttribute("data-on") === "true")!;
    expect(status.textContent).toContain("Speaking");
    expect(status.textContent).toContain("What needs my attention this week?");
    const done = [...t.host.querySelectorAll<HTMLButtonElement>(".island-end .btn")].find((b) => b.textContent === "Done")!;
    expect(done.getAttribute("data-on")).toBe("true");
    // The older, finished answer is already a card; the streaming one is not.
    expect(t.thread().querySelectorAll(".gen-card")).toHaveLength(1);
  });

  test("it reads Answer once it is complete, and announces once through the Island", async () => {
    const t = await mount(streaming());
    expect(t.q(".island > .sr-only")!.textContent).toBe("Answering");
    await t.render(settled());
    const status = [...t.host.querySelectorAll(".island-status")].find((el) => el.getAttribute("data-on") === "true")!;
    expect(status.textContent).toContain("Answer");
    expect(status.textContent).not.toContain("Speaking");
    expect(t.q(".island > .sr-only")!.textContent).toBe("Answer ready");
    expect(t.q(".island-body .gen-more")).toBeNull();
  });

  test("Done settles the answer into the thread as a card and closes the Island", async () => {
    const t = await mount(settled());
    expect(t.thread().querySelectorAll(".gen-card")).toHaveLength(1);
    const done = [...t.host.querySelectorAll<HTMLButtonElement>(".island-end .btn")].find((b) => b.textContent === "Done")!;
    await act(async () => { done.click(); });
    // The card waits for the body's exit, then rises in.
    expect(t.thread().querySelectorAll(".gen-card")).toHaveLength(1);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 260)); });
    expect(t.thread().querySelectorAll(".gen-card")).toHaveLength(2);
    expect(t.thread().querySelectorAll(".gen-card.enter")).toHaveLength(2);
    expect(t.q(".island")!.classList.contains("is-open")).toBe(false);
    expect(t.q(".island-input")!.getAttribute("data-on")).toBe("true");
    expect(document.activeElement).toBe(t.q(".island-input"));
  });

  test("asking a follow-up from the answer settles it and hands the question to the host", async () => {
    const asked: string[] = [];
    const t = await mount(settled(), { onFollowUp: (text: string) => asked.push(text) });
    expect(t.thread().querySelectorAll(".gen-card")).toHaveLength(1);
    await act(async () => { t.q<HTMLButtonElement>(".island-body .gen-chip")!.click(); });
    expect(asked).toHaveLength(1);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 260)); });
    expect(t.thread().querySelectorAll(".gen-card")).toHaveLength(2);
    expect(t.q(".island")!.classList.contains("is-open")).toBe(false);
  });

  test("a recorded approve sends the Island wave; a refused one and other intents do not", async () => {
    const base = settled();
    const last = base.messages.at(-1)!;
    const diff = { type: "diff" as const, id: "d9", label: "Proposed edit", file: "docs/plan.md", lines: [{ text: "old", del: true }, { text: "new", ins: true }], act: { label: "Approve", done: "Approved · edited", skipDone: "Not now · unchanged" } };
    const withDiff = { ...base, messages: [...base.messages.slice(0, -1), { ...last, parts: last.parts.map((part) => (part.type === "answer" ? { ...part, blocks: [...part.blocks, diff] } : part)) }] };
    const t = await mount(withDiff, { onIntent: async (event: { intent: string }) => event.intent === "approve" });
    const span = t.q<HTMLElement>(".island-wave")!;
    let waves = 0;
    span.animate = (() => { waves += 1; return {} as Animation; }) as typeof span.animate;
    const bodyActs = () => [...t.host.querySelectorAll<HTMLButtonElement>(".island-body .gen-act")];
    await act(async () => { bodyActs().find((b) => b.textContent === "Not now")!.click(); });
    expect(waves).toBe(0);
    await act(async () => { bodyActs().find((b) => b.textContent === "Approve")!.click(); });
    expect(waves).toBe(1);
  });

  test("actions inside the answer reach the host's onIntent", async () => {
    const events: unknown[] = [];
    const t = await mount(settled(), { onIntent: (event: unknown) => events.push(event) });
    await act(async () => { t.q<HTMLButtonElement>(".island-body .gen-act")!.click(); });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ answerId: "a2" });
  });
});
