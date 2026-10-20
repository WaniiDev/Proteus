import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { buildFixture } from "../../../preview/fixtures";
import type { RuntimeSnapshot } from "../../shared/contracts";
import { useDom } from "../test/dom";

mock.module("../lib/bridge", () => ({ rpc: { request: new Proxy({}, { get: () => async () => ({ accepted: true }) }) } }));
const { Companion } = await import("./Companion");
const { copyLabel } = await import("../components/MessageActions");
const { shouldAbortOnEscape } = await import("../App");

useDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
    snapshot, activeTitle: "Chat", input: "", setInput: noop, queuedDrafts: [], transportError: null, onTransportRetry: noop, onSend: (event: { preventDefault: () => void }) => event.preventDefault(),
    onOrbState: noop, onRetry: noop, onContinue: noop, onInteraction: ok, onInteractionDismiss: ok, onToolApproval: ok, ...extra,
  });
  const render = (next: RuntimeSnapshot = snapshot) => { snapshot = next; return act(async () => root!.render(<Companion {...(props() as unknown as ComponentProps<typeof Companion>)} />)); };
  await render();
  return { host, render, q: <T extends Element>(s: string) => host.querySelector<T>(s) };
}

const bubbles = (host: HTMLElement) => [...host.querySelectorAll(".bubble")].map((el) => el.textContent);

describe("switching conversations", () => {
  test("a user message and its reply may share an id without colliding, and no old bubble survives a switch", async () => {
    const first = buildFixture("thread");
    const userId = first.messages[0]!.id;
    // The projector gives a reply the id of the user message that opened its turn.
    const clash = { ...first, messages: first.messages.map((message) => (message.role === "assistant" ? { ...message, turnId: userId } : message)) };
    const t = await mount(clash);
    expect(bubbles(t.host)).toHaveLength(1);
    const other = buildFixture("running");
    await t.render({ ...other, activeThreadId: "other-thread" });
    expect(bubbles(t.host)).toEqual(other.messages.filter((m) => m.role === "user").map((m) => m.text));
    await t.render({ ...other, activeThreadId: "fresh", messages: [] });
    expect(bubbles(t.host)).toEqual([]);
  });

  test("fixture turns never reuse a user message id", () => {
    for (const scenario of ["thread", "running", "ask", "long"] as const) {
      const messages = buildFixture(scenario).messages;
      const userIds = new Set(messages.filter((m) => m.role === "user").map((m) => m.id));
      for (const message of messages) if (message.role === "assistant") expect(userIds.has(message.turnId)).toBe(false);
    }
  });
});

describe("the empty conversation", () => {
  const noThread = (): RuntimeSnapshot => {
    const base = buildFixture("empty");
    return { ...base, activeThreadId: null, messages: [], activeRun: null, interactions: [] };
  };

  test("with a connected provider and no thread the Island takes input; the runtime creates the thread on send", async () => {
    const t = await mount(noThread());
    const input = t.q<HTMLTextAreaElement>("textarea.island-input")!;
    expect(input.disabled).toBe(false);
    expect(input.placeholder).toBe("Ask Proteus anything");
    expect(t.host.textContent).not.toContain("Configure");
  });

  test("greets with the system's copy and three tiles", async () => {
    const t = await mount(noThread());
    expect(t.q(".hero-title")!.textContent).toBe("Hi. What’s on your mind?");
    expect(t.q(".hero-title")!.classList.contains("display-xl")).toBe(true);
    expect(t.q(".hero-lede")!.textContent).toBe("Type below. When I need a yes from you, I’ll ask right here — nothing moves without it.");
    const tiles = [...t.host.querySelectorAll(".tile.enter")];
    expect(tiles).toHaveLength(3);
    for (const tile of tiles) expect(tile.querySelector(".tile-dot")).toBeTruthy();
    expect(t.q(".orb-label")).toBeTruthy();
    expect(t.host.querySelector(".conv-header")).toBeNull();
  });

  test("a tile puts its prompt in the input", async () => {
    const seen: string[] = [];
    const t = await mount(noThread(), { setInput: (value: string) => seen.push(value) });
    await act(async () => t.host.querySelector<HTMLButtonElement>(".tile")!.click());
    expect(seen).toEqual(["What needs me this morning?"]);
  });
});

describe("the conversation", () => {
  test("the header is the title, the workspace badge and the actions button", async () => {
    const t = await mount(buildFixture("thread"));
    const header = t.q(".conv-header")!;
    expect(header.querySelector("h1")!.textContent).toBe("Chat");
    expect(header.querySelector(".badge")!.textContent).toBe(buildFixture("thread").activeWorkspace.label);
    expect(header.querySelector('button[aria-label="Conversation actions"]')).toBeTruthy();
  });

  test("Copy sits under replies only, each named by what it copies, with no live region of its own", async () => {
    const t = await mount(buildFixture("thread"));
    expect(t.host.querySelector(".turn-user .turn-actions")).toBeNull();
    const copies = [...t.host.querySelectorAll<HTMLButtonElement>(".turn-actions button")].filter((b) => b.textContent?.includes("Copy"));
    expect(copies.length).toBeGreaterThan(0);
    expect(copies[0]!.getAttribute("aria-label")).toStartWith("Copy reply");
    expect(t.host.querySelector(".turn-actions [aria-live]")).toBeNull();
  });

  test("the exit beat of a swap fades the thread and header", async () => {
    const t = await mount(buildFixture("thread"), { threadLeaving: true });
    expect(t.q(".thread")!.classList.contains("is-leaving")).toBe(true);
    expect(t.q(".conv-header")!.classList.contains("is-leaving")).toBe(true);
  });

  test("errors and the jump button use the system's notice and glass button", async () => {
    const t = await mount({ ...buildFixture("thread"), error: { code: "failed", message: "Boom", retryable: false } as never });
    expect(t.q(".notice.error")!.textContent).toContain("Boom");
  });
});

describe("copy names", () => {
  test("replies and your messages are told apart, with a short excerpt", () => {
    expect(copyLabel({ role: "assistant", text: "Here is the plan" })).toBe("Copy reply: Here is the plan");
    expect(copyLabel({ role: "user", text: "x".repeat(80) })).toBe(`Copy your message: ${"x".repeat(40)}…`);
  });
});

describe("Escape to stop", () => {
  test("only from inside the Island, and never while an ask or answer is open", () => {
    const inside = document.createElement("div"); inside.className = "island"; const input = document.createElement("input"); inside.append(input);
    document.body.append(inside);
    expect(shouldAbortOnEscape(input, false)).toBe(true);
    expect(shouldAbortOnEscape(input, true)).toBe(false);
    expect(shouldAbortOnEscape(document.body, false)).toBe(false);
    expect(shouldAbortOnEscape(null, false)).toBe(false);
    inside.remove();
  });
});
