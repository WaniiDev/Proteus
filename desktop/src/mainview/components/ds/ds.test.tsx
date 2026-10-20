import { describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { useDom } from "../../test/dom";
import { EmptyState } from "./EmptyState";
import { Modal } from "./Modal";

useDom();

const key = (target: Element, k: string, init: KeyboardEventInit = {}) => act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); });
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

function Harness({ log }: { log: string[] }) {
  const [open, setOpen] = useState(false);
  return <>
    <button id="trigger" onClick={() => setOpen(true)}>Forget</button>
    {open && <Modal title="Forget this project?" confirmLabel="Forget project" onCancel={() => { log.push("cancel"); setOpen(false); }} onConfirm={() => { log.push("confirm"); setOpen(false); }}>It stays on disk.</Modal>}
  </>;
}

async function mount(log: string[]) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Harness log={log} />));
  const trigger = host.querySelector<HTMLButtonElement>("#trigger")!;
  trigger.focus();
  await act(async () => trigger.click());
  return { host, root, trigger };
}

describe("Modal", () => {
  test("renders the scrim and dialog with the README copy and roles", () => {
    const html = renderToStaticMarkup(<Modal title="Delete conversation?" confirmLabel="Delete" onCancel={() => {}} onConfirm={() => {}}>Gone.</Modal>);
    expect(html).toContain('class="scrim"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("btn btn-danger sm");
    expect(html.indexOf("Cancel")).toBeLessThan(html.indexOf("Delete</button>"));
  });

  test("focuses Cancel on open", async () => {
    const { host, root } = await mount([]);
    expect(document.activeElement?.textContent).toBe("Cancel");
    await act(async () => root.unmount()); host.remove();
  });

  test("traps Tab and Shift+Tab inside the dialog", async () => {
    const { host, root } = await mount([]);
    const [cancel, confirm] = Array.from(host.querySelectorAll<HTMLButtonElement>(".modal button"));
    confirm!.focus();
    await key(document.activeElement!, "Tab");
    expect(document.activeElement).toBe(cancel);
    await key(document.activeElement!, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(confirm);
    await act(async () => root.unmount()); host.remove();
  });

  test("Escape cancels after the exit transition and returns focus to the trigger", async () => {
    const log: string[] = [];
    const { host, root, trigger } = await mount(log);
    await key(document.activeElement!, "Escape");
    expect(host.querySelector(".scrim.is-leaving")).not.toBeNull();
    expect(log).toEqual([]);
    await wait(220);
    expect(log).toEqual(["cancel"]);
    expect(host.querySelector(".scrim")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () => root.unmount()); host.remove();
  });

  test("the committing button confirms once", async () => {
    const log: string[] = [];
    const { host, root, trigger } = await mount(log);
    const confirm = host.querySelectorAll<HTMLButtonElement>(".modal button")[1]!;
    await act(async () => { confirm.click(); confirm.click(); });
    await wait(220);
    expect(log).toEqual(["confirm"]);
    expect(document.activeElement).toBe(trigger);
    await act(async () => root.unmount()); host.remove();
  });

  test("busy disables both buttons and ignores Escape", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const log: string[] = [];
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Modal title="T" confirmLabel="Go" busy onCancel={() => log.push("cancel")} onConfirm={() => {}}>b</Modal>));
    expect(Array.from(host.querySelectorAll<HTMLButtonElement>(".modal button")).every((b) => b.disabled)).toBe(true);
    await key(host.querySelector(".scrim")!, "Escape");
    await wait(220);
    expect(log).toEqual([]);
    await act(async () => root.unmount()); host.remove();
  });
});

describe("EmptyState", () => {
  test("renders title, one sentence and the one action", () => {
    const html = renderToStaticMarkup(<EmptyState title="No projects yet" action={<button className="btn btn-primary sm">Attach folder</button>}>Attach a folder.</EmptyState>);
    expect(html).toBe('<div class="empty"><h3>No projects yet</h3><p>Attach a folder.</p><button class="btn btn-primary sm">Attach folder</button></div>');
  });
});
