import { beforeEach, describe, expect, it } from "bun:test";
import { useDom } from "../../test/dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ChatAnswerPart } from "../../../shared/contracts";
import { AnswerBody } from "./AnswerBody";
import { resetDraftPicks } from "./intent-state";
import { fullBlocks, makeAnswer } from "./test-fixtures";
import type { AnswerIntentEvent } from "./types";

useDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(answer: ChatAnswerPart, props: Partial<Parameters<typeof AnswerBody>[0]> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<AnswerBody answer={answer} {...props} />); });
  return { host, rerender: (next: ChatAnswerPart) => act(async () => { root.render(<AnswerBody answer={next} {...props} />); }), unmount: () => act(async () => root.unmount()) };
}
const radios = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[role="radio"]')];
const key = (el: Element, k: string) => act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });

beforeEach(resetDraftPicks);

describe("choice keyboard", () => {
  it("keeps a picked, unconfirmed option when the answer settles and the block remounts", async () => {
    const live = makeAnswer(fullBlocks, { streaming: true });
    const first = await mount(live);
    await act(async () => { radios(first.host)[2]!.click(); });
    expect(radios(first.host)[2]!.getAttribute("aria-checked")).toBe("true");
    await first.unmount();
    const settled = await mount(makeAnswer(fullBlocks));
    expect(radios(settled.host).map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
    expect(settled.host.querySelector<HTMLButtonElement>(".gen-choice-foot button")!.disabled).toBe(false);
    // Another answer's block with the same id is its own draft.
    const other = await mount(makeAnswer(fullBlocks, { answerId: "a2" }));
    expect(radios(other.host).every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
  });

  it("has one tab stop, arrows move and pick, focus follows, Home and End jump", async () => {
    const { host } = await mount(makeAnswer(fullBlocks));
    expect(radios(host).map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    const confirm = () => host.querySelector<HTMLButtonElement>(".gen-choice-foot button")!;
    expect(confirm().disabled).toBe(true);

    radios(host)[0]!.focus();
    await key(radios(host)[0]!, "ArrowDown");
    expect(radios(host).map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(document.activeElement).toBe(radios(host)[0]!);
    expect(confirm().disabled).toBe(false);

    await key(document.activeElement!, "ArrowRight");
    expect(radios(host).map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    expect(document.activeElement).toBe(radios(host)[1]!);

    await key(document.activeElement!, "End");
    expect(document.activeElement).toBe(radios(host)[2]!);
    await key(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(radios(host)[0]!);
    await key(document.activeElement!, "ArrowUp");
    expect(document.activeElement).toBe(radios(host)[2]!);
    await key(document.activeElement!, "Home");
    expect(document.activeElement).toBe(radios(host)[0]!);
  });

  it("locks after the outcome arrives and ignores keys", async () => {
    const { host, rerender } = await mount(makeAnswer(fullBlocks));
    await act(async () => { radios(host)[1]!.click(); });
    await rerender(makeAnswer(fullBlocks, { outcomes: { c1: "Chosen · Monthly" } }));
    expect(host.querySelector(".gen-choice")!.classList.contains("is-done")).toBe(true);
    expect(radios(host).every((r) => (r as HTMLButtonElement).disabled)).toBe(true);
    await key(radios(host)[1]!, "End");
    expect(radios(host)[1]!.getAttribute("aria-checked")).toBe("true");
  });
});

describe("intents", () => {
  it("reports every action with its ids", async () => {
    const events: AnswerIntentEvent[] = [];
    const follow: string[] = [];
    const { host } = await mount(makeAnswer(fullBlocks), { onIntent: (e) => events.push(e), onFollowUp: (t) => follow.push(t) });
    const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
    await click(host.querySelector('[aria-label="Draft reply: Reply to the vendor"]'));
    await click(host.querySelector('[aria-label="Notes: Review"]'));
    await click(host.querySelector('[aria-label="Not now: leave docs/plan.md unchanged"]'));
    await click(host.querySelector('[aria-label="Approve the edit to docs/plan.md"]'));
    await click(radios(host)[1]!);
    await click(host.querySelector('[aria-label="Choose: Monthly"]'));
    await click(host.querySelector(".gen-chip"));
    expect(events).toEqual([
      { answerId: "a1", rowId: "r1", intent: "reply" },
      { answerId: "a1", rowId: "t2", intent: "open" },
      { answerId: "a1", blockId: "d1", intent: "skip" },
      { answerId: "a1", blockId: "d1", intent: "approve" },
      { answerId: "a1", blockId: "c1", intent: "choose", value: "o2" },
    ]);
    expect(follow).toEqual(["Show next week"]);
  });
});

describe("announcements", () => {
  it("announces Answering then Answer ready once", async () => {
    const seen: string[] = [];
    const { host, rerender } = await mount(makeAnswer(fullBlocks, { streaming: true }), { onAnnounce: (m) => seen.push(m) });
    await rerender(makeAnswer(fullBlocks, { streaming: true }));
    await rerender(makeAnswer(fullBlocks, { streaming: false }));
    await rerender(makeAnswer(fullBlocks, { streaming: false }));
    expect(seen).toEqual(["Answering", "Answer ready"]);
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("own region follows the stream and stays silent for a finished answer", async () => {
    const live = await mount(makeAnswer(fullBlocks, { streaming: true }));
    expect(live.host.querySelector('[role="status"]')!.textContent).toBe("Answering");
    await live.rerender(makeAnswer(fullBlocks));
    expect(live.host.querySelector('[role="status"]')!.textContent).toBe("Answer ready");
    const done = await mount(makeAnswer(fullBlocks));
    expect(done.host.querySelector('[role="status"]')!.textContent).toBe("");
  });
});
