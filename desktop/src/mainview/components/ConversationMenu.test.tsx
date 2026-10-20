import { describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useDom } from "../test/dom";
import type { RuntimeSnapshot } from "../../shared/contracts";

const calls: string[] = [];
const tree = [{ path: "src", name: "src", kind: "directory", children: [{ path: "src/a.ts", name: "a.ts", kind: "file", size: 120 }] }, { path: "README.md", name: "README.md", kind: "file", size: 2_400 }];
let failTree = false;
mock.module("../lib/bridge", () => ({
  rpc: { request: {
    "workspace.tree": async () => { calls.push("tree"); if (failTree) throw new Error("Workspace is unavailable"); return tree; },
    "workspace.read": async ({ path }: { path: string }) => { calls.push(`read:${path}`); return { path, kind: "text", content: "hello", version: "v1", size: 5, modifiedAt: "2026-08-01T00:00:00.000Z" }; },
    "workspace.write": async ({ path, content }: { path: string; content: string }) => { calls.push(`write:${path}:${content}`); return { path, kind: "text", content, version: "v2", size: content.length, modifiedAt: "2026-08-01T00:00:00.000Z" }; },
    "workspace.search": async ({ query, mode }: { query: string; mode: string }) => { calls.push(`search:${mode}:${query}`); return [{ id: "src/a.ts", content: "export const a = 1", score: 0.82 }]; },
    "workspace.index": async ({ paths }: { paths: string[] }) => { calls.push(`index:${paths.join(",")}`); return { indexed: paths.length }; },
  } },
}));
const { ConversationMenu } = await import("./ConversationMenu");

useDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

function snapshot(over: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot {
  return {
    selectedProviderId: "openrouter", selectedModelId: "openrouter/auto",
    providers: [{ id: "openrouter", name: "OpenRouter" }],
    models: [{ id: "openrouter/auto", providerId: "openrouter", name: "Auto Router" }],
    activeWorkspace: { binding: { kind: "app" }, label: "Proteus workspace", availability: "ready" },
    activeThreadId: "thread-1", activeRun: { runId: "run-live", threadId: "thread-1", status: "running" },
    workbench: { status: "waiting", tokenUsage: { promptTokens: 1234, completionTokens: 8, totalTokens: 1242 } },
    ...over,
  } as unknown as RuntimeSnapshot;
}

async function mount(snap: RuntimeSnapshot) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ConversationMenu snapshot={snap} />));
  return { host, done: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-label="Conversation actions"]')!;
const openMenu = async () => { trigger().focus(); await act(async () => trigger().click()); };
const choose = async (label: string) => { const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((el) => el.textContent?.includes(label))!; await act(async () => item.click()); await wait(200); };
// happy-dom lacks native oninput support, so React's change polyfill needs the field focused and a key event.
const typeInto = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => {
  el.focus();
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent("keyup", { key: "Unidentified", bubbles: true }));
});
const key = (k: string) => act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });
const dialog = () => document.querySelector('[role="dialog"]');

describe("ConversationMenu", () => {
  test("is a header actions button whose menu holds Files, Search and Details", async () => {
    const { done } = await mount(snapshot());
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
    await openMenu();
    const items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent);
    expect(items).toEqual(["Files in this conversation", "Search this conversation", "Details"]);
    await done();
  });

  test("has no menu to open without a conversation, and disables files and search while the folder is missing", async () => {
    const none = await mount(snapshot({ activeThreadId: null }));
    expect(trigger().disabled).toBe(true);
    await none.done();
    const missing = await mount(snapshot({ activeWorkspace: { binding: { kind: "project", projectId: "p" }, label: "P", availability: "missing" } as RuntimeSnapshot["activeWorkspace"] }));
    await openMenu();
    const files = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(files[0]!.disabled).toBe(true);
    expect(files[1]!.disabled).toBe(true);
    expect(files[2]!.disabled).toBe(false);
    await missing.done();
  });

  test("Details lists model, tokens and run ids in a Modal, and Escape returns focus to the trigger", async () => {
    const { done } = await mount(snapshot());
    await openMenu();
    await choose("Details");
    expect(dialog()?.getAttribute("aria-modal")).toBe("true");
    const text = dialog()!.textContent!;
    for (const part of ["Auto Router", "OpenRouter", "1,234", "1,242", "run-live", "thread-1"]) expect(text).toContain(part);
    expect(document.activeElement?.textContent).toBe("Close");
    await key("Escape");
    await wait(200);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    await done();
  });

  test("Details shows the last run id when it has finished, and none before any run", async () => {
    const finished = await mount(snapshot({ activeRun: { runId: "run-old", threadId: "thread-1", status: "complete" } }));
    await openMenu(); await choose("Details");
    expect(dialog()!.textContent).toContain("Last run id");
    expect(dialog()!.textContent).toContain("run-old");
    await key("Escape"); await wait(200);
    await finished.done();
    const { done } = await mount(snapshot({ activeRun: null }));
    await openMenu(); await choose("Details");
    expect(dialog()!.textContent).toContain("None yet");
    await done();
  });

  test("Files lists the workspace files as rows, opens one, and saves an edit with its version", async () => {
    calls.length = 0;
    const { done } = await mount(snapshot());
    await openMenu(); await choose("Files in this conversation");
    await wait(0);
    expect(dialog()!.querySelector("h2")?.textContent).toBe("Files in this conversation");
    const rows = Array.from(dialog()!.querySelectorAll("button.list-row"));
    expect(rows.map((row) => row.querySelector(".row-title")?.textContent)).toEqual(["src/a.ts", "README.md"]);
    await act(async () => (rows[0] as HTMLElement).click());
    expect(calls).toContain("read:src/a.ts");
    const area = dialog()!.querySelector("textarea")!;
    const save = () => Array.from(dialog()!.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Save")!;
    expect(save().disabled).toBe(true);
    await typeInto(area, "changed");
    expect(save().disabled).toBe(false);
    await act(async () => save().click());
    expect(calls).toContain("write:src/a.ts:changed");
    await done();
  });

  test("Files reports a workspace error in an alert and an empty tree as a quiet row", async () => {
    failTree = true;
    const { done } = await mount(snapshot());
    await openMenu(); await choose("Files in this conversation");
    await wait(0);
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe("Workspace is unavailable");
    expect(dialog()!.textContent).toContain("This workspace has no visible files.");
    failTree = false;
    await done();
  });

  test("Search sends the chosen mode, lists results, opens a result in Files, and indexes on request", async () => {
    calls.length = 0;
    const { done } = await mount(snapshot());
    await openMenu(); await choose("Search this conversation");
    const input = dialog()!.querySelector<HTMLInputElement>("input")!;
    const submit = () => dialog()!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit().disabled).toBe(true);
    await typeInto(input, "needle");
    await act(async () => Array.from(dialog()!.querySelectorAll<HTMLElement>('[role="tab"]')).find((el) => el.textContent === "Hybrid")!.click());
    await act(async () => submit().click());
    await wait(0);
    expect(calls).toContain("search:hybrid:needle");
    expect(dialog()!.textContent).toContain("82%");
    await act(async () => Array.from(dialog()!.querySelectorAll<HTMLElement>("button")).find((b) => b.textContent === "Index files")!.click());
    await wait(0);
    expect(calls).toContain("index:src/a.ts,README.md");
    expect(dialog()!.textContent).toContain("Indexed 2 files.");
    await act(async () => dialog()!.querySelector<HTMLElement>("button.list-row")!.click());
    await wait(0);
    expect(dialog()!.querySelector("h2")?.textContent).toBe("Files in this conversation");
    expect(calls).toContain("read:src/a.ts");
    await done();
  });
});
