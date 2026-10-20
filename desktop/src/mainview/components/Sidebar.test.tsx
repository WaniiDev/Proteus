import { describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatMessage, ThreadSummary } from "../../shared/contracts";
import { useDom } from "../test/dom";
import { Sidebar, transcriptText } from "./Sidebar";

useDom();

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const thread = (id: string, title: string, extra: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id, title, createdAt: ago(10), updatedAt: ago(4), activity: "idle", attention: 0, pinned: false, pinnedAt: null,
  workspace: { binding: { kind: "app" }, label: "Proteus workspace", availability: "ready" }, ...extra,
});
const message = (role: "user" | "assistant", text: string): ChatMessage => ({ id: `${role}${text}`, role, text, status: "complete", createdAt: ago(1), turnId: "t", parts: [] });

const base = { view: "companion" as const, disabled: false, onView: () => undefined, onCreate: () => undefined };
const threads = [
  thread("a", "Q3 planning", { pinned: true, pinnedAt: ago(2) }),
  thread("b", "Nightly sync", { activity: "running" }),
  thread("c", "Lisbon trip", { activity: "waiting" }),
  thread("d", "Broken job", { activity: "error" }),
  thread("e", "Old thing", { updatedAt: ago(60 * 24 * 5) }),
];

describe("Sidebar markup", () => {
  const html = renderToStaticMarkup(<Sidebar {...base} threads={threads} activeThreadId="b" />);

  it("renders the pane without a brand, with groups and DS classes", () => {
    expect(html).toContain('class="sidebar app-sidebar"');
    expect(html).toContain("btn btn-glass block");
    expect(html).not.toContain("proteus-orb");
    for (const name of ["Pinned", "Today", "Earlier"]) expect(html).toContain(`aria-label="${name}"`);
    expect(html.indexOf('aria-label="Pinned"')).toBeLessThan(html.indexOf('aria-label="Today"'));
    expect(html).toContain("sidebar-scroll");
    expect(html).toContain('aria-current="page"');
  });

  it("says a status in words only when it matters", () => {
    expect(html).toContain("Working");
    expect(html).toContain("Needs you");
    expect(html).toContain("Failed");
    expect(html).not.toContain("Done");
    expect(html).toContain("session-mark dot run");
  });

  it("offers Projects, Memory and Settings with aria-current on the destination", () => {
    const settings = renderToStaticMarkup(<Sidebar {...base} view="settings" settingsSection="memory" threads={[]} />);
    expect(settings).toContain("Projects");
    expect(settings).toMatch(/aria-current="page"[^>]*>(<svg[^>]*><\/svg>|<svg.*?<\/svg>)Memory/);
    expect(settings).toContain("Your conversations will appear here.");
  });

  it("disables New chat with the reason while a response runs", () => {
    expect(renderToStaticMarkup(<Sidebar {...base} disabled threads={[]} />)).toContain("Available when the current response finishes");
  });

  it("keeps long titles in one truncated line with the full title on hover", () => {
    const long = "x".repeat(300);
    expect(renderToStaticMarkup(<Sidebar {...base} threads={[thread("l", long)]} />)).toContain(`title="${long}"`);
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const key = (target: Element, k: string) => act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });

async function mount(props: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Sidebar {...base} threads={threads} activeThreadId="b" {...props} />));
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const more = (host: Element, title: string) => host.querySelector<HTMLButtonElement>(`.session-more[aria-label="Actions for ${title}"]`)!;
const items = () => Array.from(document.querySelectorAll<HTMLElement>('.menu [role="menuitem"]'));
const openMenu = async (host: Element, title: string) => { const button = more(host, title); button.focus(); await act(async () => button.click()); return button; };

describe("Sidebar actions menu", () => {
  it("opens on its first item and moves with Up, Down, Home and End", async () => {
    const { host, unmount } = await mount();
    await openMenu(host, "Nightly sync");
    expect(document.querySelector(".menu.session-menu")).not.toBeNull();
    const list = items();
    expect(list.map((item) => item.textContent)).toEqual(["Rename", "Pin to top", "Copy transcript", "Delete…"]);
    expect(document.activeElement).toBe(list[0]!);
    await key(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(list[1]!);
    await key(document.activeElement!, "End");
    expect(document.activeElement).toBe(list[3]!);
    await key(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(list[0]!);
    await key(document.activeElement!, "ArrowUp");
    expect(document.activeElement).toBe(list[3]!);
    await key(document.activeElement!, "Home");
    expect(document.activeElement).toBe(list[0]!);
    await unmount();
  });

  it("does not steal focus back on re-render", async () => {
    const { host, unmount } = await mount();
    await openMenu(host, "Nightly sync");
    await key(document.activeElement!, "End");
    const last = document.activeElement;
    await act(async () => { createRoot(document.createElement("div")); });
    expect(document.activeElement).toBe(last);
    await unmount();
  });

  it("Escape closes it and returns focus to the actions button", async () => {
    const { host, unmount } = await mount();
    const button = await openMenu(host, "Nightly sync");
    await key(document.activeElement!, "Escape");
    await wait(220);
    expect(document.querySelector(".menu")).toBeNull();
    expect(document.activeElement).toBe(button);
    await unmount();
  });

  it("pins and unpins", async () => {
    const calls: unknown[] = [];
    const { host, unmount } = await mount({ onPin: (id, pinned) => calls.push([id, pinned]) });
    await openMenu(host, "Nightly sync");
    await act(async () => items()[1]!.click());
    await wait(220);
    await openMenu(host, "Q3 planning");
    expect(items()[1]!.textContent).toBe("Unpin");
    await act(async () => items()[1]!.click());
    await wait(220);
    expect(calls).toEqual([["b", true], ["a", false]]);
    await unmount();
  });

  it("asks to delete through the host after the menu leaves", async () => {
    const asked: string[] = [];
    const { host, unmount } = await mount({ onDeleteRequest: (t) => asked.push(t.id) });
    await openMenu(host, "Nightly sync");
    await act(async () => items()[3]!.click());
    await wait(220);
    expect(asked).toEqual(["b"]);
    await unmount();
  });

  it("copies the transcript of the open conversation and disables it elsewhere with the reason", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { written.push(text); } } });
    const messages = [message("user", "Hello"), message("assistant", "Hi there")];
    const { host, unmount } = await mount({ messages });
    await openMenu(host, "Nightly sync");
    await act(async () => items()[2]!.click());
    await wait(220);
    expect(written).toEqual(["You: Hello\n\nProteus: Hi there"]);
    expect(transcriptText(messages)).toBe(written[0]!);
    await openMenu(host, "Lisbon trip");
    const copy = items().find((item) => item.textContent?.startsWith("Copy transcript"))!;
    expect((copy as HTMLButtonElement).disabled).toBe(true);
    expect(copy.textContent).toContain("Open it first");
    await unmount();
  });
});

describe("Sidebar rename", () => {
  const begin = async (host: Element, _unused?: () => void) => {
    await openMenu(host, "Nightly sync");
    await act(async () => items()[0]!.click());
    await wait(220);
    const input = host.querySelector<HTMLInputElement>(".session-rename")!;
    return input;
  };
  const type = (input: HTMLInputElement, value: string) => act(async () => { input.value = value; });

  it("edits in place, selected, and Enter commits once", async () => {
    const calls: unknown[] = [];
    const { host, unmount } = await mount({ onRename: (id, title) => calls.push([id, title]) });
    const input = await begin(host, () => undefined);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Nightly sync");
    await type(input, "  Weekly sync  ");
    await key(input, "Enter");
    await act(async () => { input.blur(); });
    expect(calls).toEqual([["b", "Weekly sync"]]);
    expect(host.querySelector(".session-rename")).toBeNull();
    await unmount();
  });

  it("Escape keeps the old title even though blur follows", async () => {
    const calls: unknown[] = [];
    const { host, unmount } = await mount({ onRename: (id, title) => calls.push([id, title]) });
    const input = await begin(host, () => undefined);
    await type(input, "Something else");
    await key(input, "Escape");
    await act(async () => { input.blur(); });
    expect(calls).toEqual([]);
    expect(host.querySelector(".session-rename")).toBeNull();
    expect(host.textContent).toContain("Nightly sync");
    await unmount();
  });

  it("clicking away commits, but an empty name is ignored", async () => {
    const calls: unknown[] = [];
    const { host, unmount } = await mount({ onRename: (id, title) => calls.push([id, title]) });
    let input = await begin(host, () => undefined);
    await type(input, "Renamed");
    await act(async () => { input.blur(); });
    expect(calls).toEqual([["b", "Renamed"]]);
    input = await begin(host, () => undefined);
    await type(input, "   ");
    await act(async () => { input.blur(); });
    expect(calls).toHaveLength(1);
    await unmount();
  });
});

describe("Sidebar navigation", () => {
  it("every row, its actions button and the destinations are real buttons in tab order", async () => {
    const { host, unmount } = await mount();
    const buttons = Array.from(host.querySelectorAll("button"));
    expect(buttons.length).toBe(1 + threads.length * 2 + 3);
    expect(buttons.every((button) => button.tabIndex === 0)).toBe(true);
    await unmount();
  });

  it("opens a conversation and reports the destinations", async () => {
    const log: string[] = [];
    const { host, unmount } = await mount({ onSwitch: (id) => log.push(`switch:${id}`), onView: (v) => log.push(`view:${v}`), onMemory: () => log.push("memory") });
    await act(async () => host.querySelector<HTMLButtonElement>('.session-main[title="Lisbon trip"]')!.click());
    const foot = Array.from(host.querySelectorAll<HTMLButtonElement>(".sidebar-foot button"));
    await act(async () => foot[0]!.click());
    await act(async () => foot[1]!.click());
    expect(log).toEqual(["switch:c", "view:companion", "view:projects", "memory"]);
    await unmount();
  });
});

describe("Sidebar rename focus and the actions button", () => {
  const rename = async (host: Element) => {
    await openMenu(host, "Nightly sync");
    await act(async () => items()[0]!.click());
    await wait(220);
    return host.querySelector<HTMLInputElement>(".session-rename")!;
  };
  const rowMain = (host: Element, title: string) => host.querySelector<HTMLElement>(`.session-main[title="${title}"]`);

  it("keeps the actions button beside the rename field", async () => {
    const { host, unmount } = await mount();
    await rename(host);
    expect(host.querySelector(".session-rename")?.closest(".session")?.querySelector(".session-more")).not.toBeNull();
    await unmount();
  });

  it("returns focus to the row after Enter and after Escape instead of dropping it to the page", async () => {
    const { host, unmount } = await mount();
    let input = await rename(host);
    await key(input, "Enter");
    expect(document.activeElement).toBe(rowMain(host, "Nightly sync")!);
    input = await rename(host);
    await key(input, "Escape");
    expect(document.activeElement).toBe(rowMain(host, "Nightly sync")!);
    await unmount();
  });
});

describe("Sidebar deleting a conversation", () => {
  it("keeps the row mounted as .is-leaving for the enter beat, then removes it", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Sidebar {...base} threads={threads} activeThreadId="a" />));
    expect(host.querySelectorAll(".session")).toHaveLength(5);
    await act(async () => root.render(<Sidebar {...base} threads={threads.filter((item) => item.id !== "b")} activeThreadId="a" />));
    const leaving = host.querySelectorAll(".session.is-leaving");
    expect(leaving).toHaveLength(1);
    expect(leaving[0]!.textContent).toContain("Nightly sync");
    expect(host.querySelectorAll(".session")).toHaveLength(5);
    await wait(320);
    expect(host.querySelector(".session.is-leaving")).toBeNull();
    expect(host.querySelectorAll(".session")).toHaveLength(4);
    expect(host.textContent).not.toContain("Nightly sync");
    await act(async () => root.unmount()); host.remove();
  });
});
