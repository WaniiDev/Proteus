import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { InteractionResponseResult, PendingInteraction } from "../../../../shared/contracts";
import { useDom } from "../../../test/dom";
import { Island } from "../Island";
import { AskBody, type AskHandlers } from "./AskBody";

useDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ok: InteractionResponseResult = { accepted: true };
const base: PendingInteraction = { id: "i1", toolCallId: "t1", kind: "tool_approval", title: "Allow mastra_workspace_edit_file?", toolName: "mastra_workspace_edit_file", args: { path: "docs/plan.md", old_string: "Beta", new_string: "Launch" }, fingerprint: "fp-1", options: [], status: "pending", createdAt: "2026-08-04T00:00:00.000Z" };

let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.innerHTML = ""; });

function handlers(over: Partial<AskHandlers> = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const h: AskHandlers = {
    onRespond: async (id, response) => { calls.push(["respond", id, response]); return ok; },
    onApproval: async (id, approved, fingerprint) => { calls.push(["approval", id, approved, fingerprint]); return ok; },
    onResubmit: async (id) => { calls.push(["resubmit", id]); return true; },
    onDismiss: async (id) => { calls.push(["dismiss", id]); return ok; },
    ...over,
  };
  return { h, calls };
}

/** The ask inside a real Island, so focus in and out and the kicker are the real thing. */
async function mount(interaction: PendingInteraction | null, h: AskHandlers, extra: { count?: number } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const view = (current: PendingInteraction | null) => (
    <Island orbState="waiting" docked orbAnchorRef={() => undefined} mode={current ? "ask" : "input"} end="send" status={{ label: "", line: "" }} askKind={extra.count && extra.count > 1 ? `Edit file · 1 of ${extra.count}` : "Edit file"} input="" placeholder="Ask a follow-up…" inputDisabled={false} sendLabel="Send" sendDisabled onInput={() => undefined} onSubmit={() => undefined} onStop={() => undefined} open={current !== null} body={current ? <AskBody key={current.id} interaction={current} {...h} /> : null} bodyScroll />
  );
  await act(async () => root!.render(view(interaction)));
  return { host, rerender: (current: PendingInteraction | null) => act(async () => root!.render(view(current))), q: <T extends Element>(s: string) => host.querySelector<T>(s)!, buttons: () => [...host.querySelectorAll<HTMLButtonElement>(".island-actions button")] };
}

describe("tool approval ask", () => {
  test("names the change, shows it in mono, and offers Decline and a concrete Approve", async () => {
    const t = await mount(base, handlers().h);
    expect(t.q(".island-title").textContent).toBe("Edit docs/plan.md");
    expect(t.q(".island-text").textContent).toContain("change this file");
    expect(t.q(".island-code").textContent).toBe("- Beta\n+ Launch");
    expect(t.buttons().map((b) => [b.textContent, b.className])).toEqual([["Decline", "btn btn-island-quiet"], ["Approve edit", "btn btn-island"]]);
    expect(t.q(".island-kicker").textContent).toBe("Needs you · Edit file");
    expect(t.q(".island.is-open")).toBeTruthy();
    expect(t.host.textContent).toContain("Your call. Nothing moves without you.");
  });

  test("approve passes the fingerprint, shows Approving… with a spinner, and pulses once accepted", async () => {
    let release: (value: InteractionResponseResult) => void = () => undefined;
    let approved = 0;
    const { h, calls } = handlers({ onApproval: (id, yes, fingerprint) => { calls.push(["approval", id, yes, fingerprint]); return new Promise((resolve) => { release = resolve; }); }, onApproved: () => { approved += 1; } });
    const t = await mount(base, h);
    await act(async () => { t.buttons()[1]!.click(); });
    expect(calls).toEqual([["approval", "t1", true, "fp-1"]]);
    expect(t.buttons().map((b) => b.disabled)).toEqual([true, true]);
    expect(t.buttons()[1]!.textContent).toBe("Approving…");
    expect(t.buttons()[1]!.querySelector(".spinner")).toBeTruthy();
    expect(approved).toBe(0);
    await act(async () => { release(ok); });
    expect(approved).toBe(1);
  });

  test("decline sends false with the same fingerprint and does not pulse", async () => {
    let approved = 0;
    const { h, calls } = handlers({ onApproved: () => { approved += 1; } });
    const t = await mount(base, h);
    await act(async () => { t.buttons()[0]!.click(); });
    expect(calls).toEqual([["approval", "t1", false, "fp-1"]]);
    expect(approved).toBe(0);
  });

  test("every tool approval states the host-execution limitation in an island-note; a question does not", async () => {
    const t = await mount(base, handlers().h);
    expect(t.q(".island-note").textContent).toBe("On Windows this runs on your machine without a sandbox.");
    await t.rerender(null);
    await t.rerender({ ...base, kind: "ask_user", question: "Which?", toolName: undefined, args: undefined });
    expect(t.host.querySelector(".island-note")).toBeNull();
  });

  test("busy is the spinner and the participle on the primary only: no extra line", async () => {
    const { h } = handlers({ onApproval: () => new Promise(() => undefined) });
    const t = await mount(base, h);
    await act(async () => { t.buttons()[1]!.click(); });
    expect([...t.host.querySelectorAll(".island-note")].map((n) => n.textContent)).toEqual(["On Windows this runs on your machine without a sandbox."]);
    expect(t.host.textContent).not.toContain("Approving tool");
  });

  test("a refused decision re-enables the buttons and says why", async () => {
    const { h } = handlers({ onApproval: async () => ({ accepted: false, code: "stale", message: "That request changed.", retryable: false }) });
    const t = await mount(base, h);
    await act(async () => { t.buttons()[1]!.click(); });
    expect([...t.host.querySelectorAll(".island-note")].map((n) => n.textContent)).toEqual(["On Windows this runs on your machine without a sandbox.", "That request changed."]);
    expect(t.buttons().map((b) => b.disabled)).toEqual([false, false]);
    expect(t.buttons()[1]!.textContent).toBe("Approve edit");
  });

  test("focus moves into the ask once, lands on the title, and Enter there approves nothing", async () => {
    const { h, calls } = handlers();
    const t = await mount(base, h);
    expect(document.activeElement).toBe(t.q(".island-title"));
    await act(async () => { t.q(".island-title").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(calls).toEqual([]);
    const other = document.createElement("button");
    document.body.append(other);
    other.focus();
    await t.rerender(base);
    expect(document.activeElement).toBe(other);
  });

  test("focus returns to the input when the ask closes", async () => {
    const t = await mount(base, handlers().h);
    expect(t.q(".island-body").contains(document.activeElement)).toBe(true);
    await t.rerender(null);
    expect(document.activeElement).toBe(t.q(".island-input"));
  });
});

describe("question ask", () => {
  const question: PendingInteraction = { id: "i2", toolCallId: "t2", kind: "ask_user", title: "A question from Proteus", question: "Which environment?", options: [{ label: "Local", description: "In-memory" }, { label: "Staging" }], selectionMode: "single_select", status: "pending", createdAt: "2026-08-04T00:00:00.000Z" };

  test("options are radios, Answer stays disabled until one is picked, and the reply is the option", async () => {
    const { h, calls } = handlers();
    const t = await mount(question, h);
    expect(t.host.querySelectorAll(".island-options input[type=radio]")).toHaveLength(3);
    expect(t.buttons().map((b) => b.textContent)).toEqual(["Answer"]);
    expect(t.buttons()[0]!.disabled).toBe(true);
    await act(async () => { t.host.querySelectorAll<HTMLInputElement>(".island-options input")[1]!.click(); });
    await act(async () => { t.buttons()[0]!.click(); });
    expect(calls).toEqual([["respond", "t2", "Staging"]]);
  });

  test("a question offers Answer only: ask_user has no cancel value to send", async () => {
    const t = await mount(question, handlers().h);
    expect(t.buttons().map((b) => b.textContent)).toEqual(["Answer"]);
  });

  test("Other reveals a field and sends the typed value", async () => {
    const { h, calls } = handlers();
    const t = await mount(question, h);
    await act(async () => { t.host.querySelectorAll<HTMLInputElement>(".island-options input")[2]!.click(); });
    const field = t.q<HTMLInputElement>("input.island-field");
    expect(field).toBeTruthy();
    expect(t.buttons()[0]!.disabled).toBe(true);
    // react-dom loads before the test DOM exists, so it cannot see native "input" events; its fallback is focus + keyup.
    await act(async () => {
      field.focus();
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, "Preview");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new KeyboardEvent("keyup", { key: "w", bubbles: true }));
    });
    await act(async () => { t.buttons()[0]!.click(); });
    expect(calls).toEqual([["respond", "t2", { kind: "other", value: "Preview" }]]);
  });

  test("a question without options is a field that takes focus", async () => {
    const t = await mount({ ...question, options: [] }, handlers().h);
    expect(document.activeElement).toBe(t.q("textarea.island-field"));
  });
});

describe("plan and recovery asks", () => {
  const plan: PendingInteraction = { id: "i3", toolCallId: "t3", kind: "submit_plan", title: "Ship the beta", status: "pending", options: [], createdAt: "2026-08-04T00:00:00.000Z", plan: { version: 1, title: "Ship the beta", summary: "Three steps", steps: ["Write the notes", "Tag the release"], status: "draft" } };

  test("steps are an ordered list; Approve plan and Request changes send the feedback", async () => {
    const { h, calls } = handlers();
    const t = await mount(plan, h);
    expect([...t.host.querySelectorAll(".island-steps li")].map((li) => li.textContent)).toEqual(["Write the notes", "Tag the release"]);
    expect(t.buttons().map((b) => b.textContent)).toEqual(["Request changes", "Approve plan"]);
    await act(async () => { t.buttons()[0]!.click(); });
    expect(calls).toEqual([["respond", "t3", { action: "rejected", feedback: "Please revise the plan." }]]);
  });

  test("approving a plan pulses the orb", async () => {
    let approved = 0;
    const t = await mount(plan, handlers({ onApproved: () => { approved += 1; } }).h);
    await act(async () => { t.buttons()[1]!.click(); });
    expect(approved).toBe(1);
  });

  test("recovery says what failed and offers Dismiss and Resubmit turn", async () => {
    const failed: PendingInteraction = { ...plan, status: "failed", originMessageId: "m1", error: { code: "resume-failed", message: "Mastra could not resume this request.", retryable: true } };
    const { h, calls } = handlers();
    const t = await mount(failed, h);
    expect(t.q(".island-text").textContent).toBe("Mastra could not resume this request.");
    expect(t.buttons().map((b) => b.textContent)).toEqual(["Dismiss", "Resubmit turn"]);
    await act(async () => { t.buttons()[0]!.click(); t.buttons()[1]!.click(); });
    expect(calls).toEqual([["dismiss", "t3"], ["resubmit", "m1"]]);
  });
});
