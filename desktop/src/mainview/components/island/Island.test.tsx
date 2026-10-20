import { describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { useDom } from "../../test/dom";
import { Island, type IslandProps } from "./Island";

useDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const base: IslandProps = {
  orbState: "idle", docked: false, orbAnchorRef: () => undefined, mode: "input", end: "send",
  status: { label: "Thinking", line: "Thinking…" }, askKind: "Approval", input: "", placeholder: "Ask Proteus anything",
  inputDisabled: false, sendLabel: "Send", sendDisabled: true, onInput: () => undefined, onSubmit: () => undefined, onStop: () => undefined,
};

async function mount(initial: Partial<IslandProps> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (props: Partial<IslandProps> = {}) => act(async () => root.render(<Island {...base} {...initial} {...props} />));
  await render();
  const q = <T extends Element>(selector: string) => host.querySelector<T>(selector)!;
  const qa = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
  const visibleStatus = () => qa(".island-status").filter((el) => el.getAttribute("data-on") === "true");
  return { host, render, q, qa, visibleStatus, done: () => act(async () => { root.unmount(); host.remove(); }) };
}

describe("Island variants", () => {
  test("every variant stays mounted as the visible one changes, and the elements are never replaced", async () => {
    const t = await mount();
    const nodes = [t.q(".island-input"), ...t.qa(".island-status"), t.q(".island-send"), t.q(".island-end .btn")];
    expect(t.qa(".island-status")).toHaveLength(4);
    for (const props of [{ mode: "status", end: "stop" }, { mode: "ask", end: "send" }, { mode: "input", end: "send" }] as const) {
      await t.render({ ...props, status: { label: "Working", line: "Reading notes/plan.md" } });
      expect([t.q(".island-input"), ...t.qa(".island-status"), t.q(".island-send"), t.q(".island-end .btn")]).toEqual(nodes);
      expect(t.qa("[data-on]").length).toBe(8);
    }
    await t.done();
  });

  test("hidden variants are inert: aria-hidden, inert and disabled controls", async () => {
    const t = await mount();
    expect(t.q(".island-input").getAttribute("data-on")).toBe("true");
    expect((t.q(".island-input") as HTMLTextAreaElement).disabled).toBe(false);
    expect((t.q(".island-end .btn") as HTMLButtonElement).disabled).toBe(true);
    for (const el of t.qa(".island-status")) {
      expect(el.getAttribute("data-on")).toBe("false");
      expect(el.getAttribute("aria-hidden")).toBe("true");
      expect(el.hasAttribute("inert")).toBe(true);
    }
    await t.render({ mode: "status", end: "stop", status: { label: "Working", line: "Reading notes/plan.md" } });
    expect((t.q(".island-input") as HTMLTextAreaElement).disabled).toBe(true);
    expect((t.q(".island-send") as HTMLButtonElement).disabled).toBe(true);
    expect((t.q(".island-end .btn") as HTMLButtonElement).disabled).toBe(false);
    expect(t.q(".island-end .btn").textContent).toBe("Stop");
    await t.done();
  });

  test("Send is disabled while the input is empty and submits once with text", async () => {
    let submits = 0;
    const t = await mount({ onSubmit: (event) => { event.preventDefault(); submits += 1; } });
    const send = t.q<HTMLButtonElement>(".island-send");
    expect(send.disabled).toBe(true);
    expect(send.getAttribute("aria-label")).toBe("Send");
    await act(async () => { t.q<HTMLFormElement>(".island-row").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(submits).toBe(0);
    await t.render({ input: "Hello", sendDisabled: false });
    expect(send.disabled).toBe(false);
    await act(async () => { t.q<HTMLFormElement>(".island-row").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(submits).toBe(1);
    await t.done();
  });

  test("Stop calls onStop, and the stopped run says nothing was sent or saved before the input returns", async () => {
    let stops = 0;
    const t = await mount({ mode: "status", end: "stop", onStop: () => { stops += 1; }, stoppedMs: 40 });
    await act(async () => { t.q<HTMLButtonElement>(".island-end .btn").click(); });
    expect(stops).toBe(1);
    await t.render({ mode: "input", end: "send" });
    expect(t.visibleStatus().map((el) => el.textContent)).toEqual(["Stopped. Nothing was sent or saved."]);
    expect(t.q(".island-input").getAttribute("data-on")).toBe("false");
    await act(async () => { await sleep(80); });
    expect(t.visibleStatus()).toHaveLength(0);
    expect(t.q(".island-input").getAttribute("data-on")).toBe("true");
    await t.done();
  });

  test("a run that ends without Stop does not claim it was stopped", async () => {
    const t = await mount({ mode: "status", end: "stop" });
    await t.render({ mode: "input", end: "send" });
    expect(t.visibleStatus()).toHaveLength(0);
    expect(t.q(".island-input").getAttribute("data-on")).toBe("true");
    await t.done();
  });

  test("status changes alternate two slots; the old words stay hidden while the new ones are the one announcement", async () => {
    const t = await mount({ mode: "status", end: "stop", status: { label: "Working", line: "Reading notes/plan.md" } });
    expect(t.visibleStatus().map((el) => el.textContent)).toEqual(["Working Reading notes/plan.md"]);
    const first = t.visibleStatus()[0]!;
    await t.render({ status: { label: "Working", line: "Editing notes/plan.md" } });
    expect(t.visibleStatus().map((el) => el.textContent)).toEqual(["Working Editing notes/plan.md"]);
    expect(t.visibleStatus()[0]).not.toBe(first);
    expect(first.getAttribute("aria-hidden")).toBe("true");
    expect(first.textContent).toBe("Working Reading notes/plan.md");
    await t.render({ status: { label: "Working", line: "Editing notes/plan.md" } });
    expect(t.visibleStatus().map((el) => el.textContent)).toEqual(["Working Editing notes/plan.md"]);
    await t.done();
  });

  test("the Island is the one live region and the ask kicker is announced there", async () => {
    const t = await mount();
    expect(t.qa("[aria-live]")).toHaveLength(1);
    expect(t.q(".island").getAttribute("aria-live")).toBe("polite");
    expect(t.qa('[role="status"], [role="alert"], [aria-live]:not(.island)')).toHaveLength(0);
    await t.render({ mode: "ask", end: "stop", askKind: "Approval" });
    expect(t.qa(".island-end > [data-on='true']")).toHaveLength(0);
    expect(t.visibleStatus().map((el) => el.textContent)).toEqual(["Needs you · ApprovalYour call. Nothing moves without you."]);
    await t.done();
  });

  test("answer mode shows the label and question, ends with Done, and announces through the one live region", async () => {
    let done = 0;
    const t = await mount({ mode: "answer", answerLabel: "Speaking", answerLine: "What needs my attention?", announcement: "Answering", onDone: () => { done += 1; } });
    expect(t.visibleStatus().map((el) => el.textContent)).toEqual(["Speaking What needs my attention?"]);
    expect(t.qa(".island-end > [data-on='true']").map((el) => el.textContent)).toEqual(["Done"]);
    expect((t.q(".island-input") as HTMLTextAreaElement).disabled).toBe(true);
    expect(t.q(".island > .sr-only").textContent).toBe("Answering");
    expect(t.qa("[aria-live]")).toHaveLength(1);
    await act(async () => { t.qa(".island-end .btn").find((el) => el.textContent === "Done")!.click(); });
    expect(done).toBe(1);
    await t.render({ mode: "answer", answerLabel: "Answer", answerLine: "What needs my attention?" });
    expect(t.visibleStatus()[0]!.textContent).toContain("Answer What");
    await t.done();
  });

  test("the body is an always-mounted slot that is inert until the Island is open", async () => {
    const t = await mount({ body: <p className="probe">Edit docs/plan.md</p> });
    const body = t.q(".island-body");
    expect(t.q(".probe")).toBeTruthy();
    expect(body.getAttribute("aria-hidden")).toBe("true");
    expect(body.hasAttribute("inert")).toBe(true);
    expect(t.q(".island").classList.contains("is-open")).toBe(false);
    await t.render({ open: true, body: <p className="probe">Edit docs/plan.md</p> });
    expect(t.q(".island").classList.contains("is-open")).toBe(true);
    expect(body.getAttribute("aria-hidden")).toBe("false");
    expect(body.hasAttribute("inert")).toBe(false);
    await t.done();
  });

  test("opening plays one sheen and clears it afterwards; the orb state colours the glass", async () => {
    const t = await mount({ orbState: "working" });
    expect(t.q(".island").getAttribute("data-orb")).toBe("working");
    await t.render({ open: true });
    expect(t.q(".island").classList.contains("is-morphing")).toBe(true);
    await t.render({ open: true });
    expect(t.qa(".island.is-morphing")).toHaveLength(1);
    await act(async () => { await sleep(760); });
    expect(t.q(".island").classList.contains("is-morphing")).toBe(false);
    await t.done();
  });

  test("the orb slot opens once the conversation starts", async () => {
    const t = await mount();
    expect(t.q(".island-orb-slot").classList.contains("is-docked")).toBe(false);
    await t.render({ docked: true });
    expect(t.q(".island-orb-slot").classList.contains("is-docked")).toBe(true);
    await t.done();
  });

  test("a controlled draft survives mode switches", async () => {
    function Harness({ mode }: { mode: "input" | "status" }) {
      const [value, setValue] = useState("Draft");
      return <Island {...base} mode={mode} end={mode === "input" ? "send" : "stop"} input={value} onInput={setValue} sendDisabled={false} />;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Harness mode="input" />));
    await act(async () => root.render(<Harness mode="status" />));
    await act(async () => root.render(<Harness mode="input" />));
    expect((host.querySelector(".island-input") as HTMLTextAreaElement).value).toBe("Draft");
    await act(async () => { root.unmount(); host.remove(); });
  });
});
