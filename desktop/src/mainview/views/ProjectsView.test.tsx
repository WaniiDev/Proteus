import { describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useDom } from "../test/dom";
import type { RuntimeSnapshot } from "../../shared/contracts";

const calls: string[] = [];
mock.module("../lib/bridge", () => ({
  rpc: { request: {
    "memory.get": async () => ({ scopes: [] }),
    "projects.attach": async () => { calls.push("attach"); },
    "projects.open": async () => { calls.push("open"); },
    "projects.reconnect": async () => { calls.push("reconnect"); },
    "projects.remove": async (input: { projectId: string }) => { calls.push(`remove:${input.projectId}`); },
  } },
}));
const { ProjectsView } = await import("./ProjectsView");

useDom();

const iso = "2026-08-01T00:00:00.000Z";
const longName = "A very long project name ".repeat(8).trim();
const longPath = "/home/user/" + "deeply/nested/".repeat(12) + "folder";
const project = (id: string, name: string, availability: "ready" | "missing", rootPath = `/home/${id}`) => ({ id, name, rootPath, availability, createdAt: iso, updatedAt: iso, lastOpenedAt: iso });
const thread = (id: string, projectId: string) => ({ id, pinned: false, pinnedAt: null, title: `Chat ${id}`, createdAt: iso, updatedAt: iso, activity: "idle" as const, attention: 0, workspace: { binding: { kind: "project" as const, projectId }, label: projectId, availability: "ready" as const } });
const snapshot = (projects: ReturnType<typeof project>[], threads: ReturnType<typeof thread>[] = []) => ({ projects, threads, activeRun: null }) as unknown as RuntimeSnapshot;
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

async function mount(snap: RuntimeSnapshot, handlers: Partial<Record<"onCreateChat" | "onSelectThread" | "onOpenMemory", (id: string) => void>> = {}) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ProjectsView snapshot={snap} onCreateChat={handlers.onCreateChat ?? (() => {})} onSelectThread={handlers.onSelectThread ?? (() => {})} onOpenMemory={handlers.onOpenMemory ?? (() => {})} />));
  return { host, done: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const click = (el: Element | null | undefined) => act(async () => { (el as HTMLElement).click(); });
const byText = (host: Element, selector: string, text: string) => Array.from(host.querySelectorAll(selector)).find((el) => el.textContent?.includes(text));

describe("ProjectsView", () => {
  test("lists projects as navigation rows with name, mono path, chat count and chevron", async () => {
    const { host, done } = await mount(snapshot([project("p1", longName, "ready", longPath), project("p2", "Old", "missing")], [thread("t1", "p1"), thread("t2", "p1")]));
    const rows = host.querySelectorAll("button.list-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector(".row-title")?.textContent).toBe(longName);
    expect(rows[0]!.querySelector(".row-sub.mono")?.textContent).toBe(longPath);
    expect(rows[0]!.querySelector(".row-end")?.textContent).toBe("2 chats");
    expect(rows[0]!.querySelector(".row-end svg")).not.toBeNull();
    expect(rows[1]!.querySelector(".row-end .dot.warn")).not.toBeNull();
    expect(host.querySelector(".page-head h1.heading")?.textContent).toBe("Projects");
    expect(host.querySelector("input")).toBeNull();
    await done();
  });

  test("shows the EmptyState with the one action when there are no projects", async () => {
    calls.length = 0;
    const { host, done } = await mount(snapshot([]));
    expect(host.querySelector(".empty h3")?.textContent).toBe("No projects yet");
    expect(host.querySelectorAll("button")).toHaveLength(1);
    await click(host.querySelector(".empty button"));
    expect(calls).toEqual(["attach"]);
    await done();
  });

  test("Attach folder sits in the page actions when projects exist", async () => {
    calls.length = 0;
    const { host, done } = await mount(snapshot([project("p1", "One", "ready")]));
    await click(byText(host, ".page-head button", "Attach folder"));
    expect(calls).toEqual(["attach"]);
    await done();
  });

  test("project page: back link, heading, chats, and a missing folder offers Reconnect", async () => {
    calls.length = 0;
    const picked: string[] = [];
    const { host, done } = await mount(snapshot([project("p1", "One", "ready"), project("p2", "Gone", "missing")], [thread("t1", "p1")]), { onSelectThread: (id) => picked.push(id) });
    await click(host.querySelector("button.list-row"));
    expect(host.querySelector("button.page-back")?.textContent).toBe("Projects");
    expect(host.querySelector(".page-head h1")?.textContent).toBe("One");
    await click(byText(host, "button.list-row", "Chat t1"));
    expect(picked).toEqual(["t1"]);
    await click(host.querySelector("button.page-back"));
    await click(host.querySelectorAll("button.list-row")[1]);
    expect(host.querySelector(".notice.warn")).not.toBeNull();
    await click(byText(host, ".page-actions button", "Reconnect"));
    expect(calls).toEqual(["reconnect"]);
    await done();
  });

  test("Forget project opens the Modal, Escape closes it and focus returns to the trigger", async () => {
    calls.length = 0;
    const { host, done } = await mount(snapshot([project("p1", "One", "ready")]));
    await click(host.querySelector("button.list-row"));
    const trigger = byText(host, "button.list-row.danger", "Forget project") as HTMLButtonElement;
    trigger.focus();
    await click(trigger);
    expect(host.querySelector(".scrim .modal h2")?.textContent).toBe("Forget this project?");
    expect(document.activeElement?.textContent).toBe("Cancel");
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    await wait(220);
    expect(host.querySelector(".scrim")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(calls).toEqual([]);
    await done();
  });

  test("confirming Forget project removes it", async () => {
    calls.length = 0;
    const { host, done } = await mount(snapshot([project("p1", "One", "ready")]));
    await click(host.querySelector("button.list-row"));
    await click(byText(host, "button.list-row.danger", "Forget project"));
    await click(host.querySelector(".modal .btn-danger"));
    await wait(220);
    expect(calls).toEqual(["remove:p1"]);
    await done();
  });

  test("keeps scoped memory and project chat creation wired", async () => {
    const view = await Bun.file(new URL("./ProjectsView.tsx", import.meta.url)).text();
    const app = await Bun.file(new URL("../App.tsx", import.meta.url)).text();
    expect(view).toContain('rpc.request["memory.get"]({ scope: { kind: "project", projectId: selected.id } })');
    expect(view).toContain("onOpenMemory(selected.id)");
    expect(app).toContain('createChat({ kind: "project", projectId }');
    expect(app).toContain('setSettingsSection("memory")');
  });
});
