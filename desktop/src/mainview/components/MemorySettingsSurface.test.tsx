import { describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useDom } from "../test/dom";
import { renderToStaticMarkup } from "react-dom/server";
import type { MemorySettingsState } from "../../shared/contracts";
import { MemorySettingsSurface } from "./MemorySettingsSurface";

useDom();

function memoryState(): MemorySettingsState {
  return {
    enabled: true,
    scopes: [
      {
        scope: { kind: "global" },
        key: "global",
        label: "Everywhere",
        status: "active",
        entries: [{
          id: "memory-1",
          category: "preference",
          content: "Lead status updates with blockers.",
          createdAt: "2026-08-10T09:00:00.000Z",
          updatedAt: "2026-08-11T09:00:00.000Z",
        }],
      },
      {
        scope: { kind: "project", projectId: "proteus" },
        key: "project:proteus",
        label: "Proteus",
        status: "archived",
        entries: [],
      },
    ],
  };
}

function render(state: MemorySettingsState, focusKey = "global", error: string | null = null): string {
  const saved = async () => true;
  return renderToStaticMarkup(<MemorySettingsSurface
    state={state}
    focusKey={focusKey}
    busy={false}
    error={error}
    onSetEnabled={saved}
    onCreate={saved}
    onUpdate={saved}
    onDelete={saved}
    onReset={saved}
  />);
}

describe("memory settings on Page + List", () => {
  test("renders the switch row, a space switch, the composer as the first row, and grouped saved items", () => {
    const html = render(memoryState());
    expect(html).toContain("list-row switch");
    expect(html).toContain("Memory is on");
    expect(html).toContain("Proteus can reuse what you save here.");
    expect(html).toContain("Nothing is learned silently.");
    expect(html).toContain('role="tablist"');
    expect(html).toContain("Everywhere");
    expect(html).toContain("row-compose");
    expect(html).toContain('placeholder="Remember that…"');
    expect(html).toContain("Saves to Everywhere. Press Enter to save.");
    expect(html).toContain("list-label kicker\">Preferences");
    expect(html).toContain("Lead status updates with blockers.");
    expect(html).toContain("Edit Lead status updates with blockers.");
    expect(html).toContain("Forget Lead status updates with blockers.");
    expect(html).toContain("btn btn-danger-ghost sm");
    expect(html).toContain("list-row danger");
    expect(html).toContain("Clear Everywhere");
    expect(html).not.toContain("memory-control");
    expect(html).not.toContain("modal-card");
  });

  test("paused: says so, locks the composer, and keeps saved context visible", () => {
    const state = memoryState();
    state.enabled = false;
    const html = render(state);
    expect(html).toContain("Memory is paused");
    expect(html).toContain("Nothing is read or saved until you turn it back on.");
    expect(html).toContain("Memory is paused. Turn it on to save.");
    expect(html).toContain("disabled");
    expect(html).toContain("Lead status updates with blockers.");
  });

  test("the focused archived project shows the quiet empty line and no Clear row", () => {
    const html = render(memoryState(), "project:proteus");
    expect(html).toContain("Nothing saved in Proteus yet. Add only what you want Proteus to reuse.");
    expect(html).toContain("list-row quiet");
    expect(html).not.toContain("Clear Proteus");
    expect(html).toContain("Saves to Proteus");
  });

  test("a failed mutation is a field-error alert and keeps loaded state", () => {
    const html = render(memoryState(), "global", "The memory change could not be saved. Nothing was changed.");
    expect(html).toContain('class="field-error" role="alert"');
    expect(html).toContain("Nothing was changed.");
    expect(html).toContain("Lead status updates with blockers.");
  });

  test("more than four spaces use a Select instead of a Segmented", () => {
    const state = memoryState();
    for (let i = 0; i < 4; i += 1) state.scopes.push({ scope: { kind: "project", projectId: `p${i}` }, key: `project:p${i}`, label: `Project ${i}`, status: "active", entries: [] });
    const html = render(state);
    expect(html).toContain("select-trigger");
    expect(html).not.toContain('role="tablist"');
  });
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 220));

describe("memory settings behaviour", () => {
  async function mount(state: MemorySettingsState, calls: string[]) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const saved = (name: string) => async (...args: unknown[]) => { calls.push(`${name}:${args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join("|")}`); return true; };
    await act(async () => root.render(<MemorySettingsSurface state={state} focusKey="global" busy={false} error={null}
      onSetEnabled={saved("enabled")} onCreate={saved("create")} onUpdate={saved("update")} onDelete={saved("delete")} onReset={saved("reset")} />));
    return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
  }
  const button = (host: HTMLElement, label: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === label || b.getAttribute("aria-label") === label)!;

  test("Forget asks first, then deletes the entry", async () => {
    const calls: string[] = [];
    const h = await mount(memoryState(), calls);
    await act(async () => button(h.host, "Forget Lead status updates with blockers.").click());
    expect(h.host.querySelector('[role="dialog"]')?.textContent).toContain("Forget this?");
    expect(calls).toEqual([]);
    await act(async () => button(h.host.querySelector<HTMLElement>(".modal")!, "Forget").click());
    await act(async () => { await settle(); });
    expect(calls).toEqual(["delete:{\"kind\":\"global\"}|memory-1"]);
    expect(h.host.querySelector('[role="dialog"]')).toBeNull();
    await h.unmount();
  });

  test("the dialog traps Tab, closes on Escape and Cancel, and returns focus to the trigger", async () => {
    const calls: string[] = [];
    const h = await mount(memoryState(), calls);
    const trigger = button(h.host, "Clear Everywhere");
    await act(async () => trigger.focus());
    await act(async () => trigger.click());
    expect(h.host.querySelector('[role="dialog"]')?.textContent).toContain("Clear Everywhere?");
    const cancel = button(h.host, "Cancel");
    const confirm = button(h.host.querySelector<HTMLElement>(".modal")!, "Clear");
    expect(document.activeElement).toBe(cancel);
    const tab = async (shiftKey = false) => act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true })); });
    await tab(true);
    expect(document.activeElement).toBe(confirm);
    await tab();
    expect(document.activeElement).toBe(cancel);

    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(h.host.querySelector(".scrim")!.className).toContain("is-leaving");
    await act(async () => { await settle(); });
    expect(h.host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button(h.host, "Clear Everywhere"));

    await act(async () => button(h.host, "Clear Everywhere").click());
    await act(async () => button(h.host, "Cancel").click());
    await act(async () => { await settle(); });
    expect(h.host.querySelector('[role="dialog"]')).toBeNull();
    expect(calls).toEqual([]);
    await h.unmount();
  });

  test("Edit loads the item into the composer and saves changes as an update", async () => {
    const calls: string[] = [];
    const h = await mount(memoryState(), calls);
    await act(async () => button(h.host, "Edit Lead status updates with blockers.").click());
    expect(h.host.querySelector<HTMLInputElement>(".row-input")!.value).toBe("Lead status updates with blockers.");
    expect(button(h.host, "Save changes")).toBeTruthy();
    await act(async () => { h.host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(calls[0]).toContain("update:");
    await h.unmount();
  });
});
