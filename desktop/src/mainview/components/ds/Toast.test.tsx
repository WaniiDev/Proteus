import { describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useDom } from "../../test/dom";
import { ToastProvider, useToast, useToastAnnouncement } from "./Toast";

useDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

function Probe() {
  const toast = useToast();
  const announcement = useToastAnnouncement();
  return <>
    <button id="a" onClick={() => toast("Transcript copied")}>a</button>
    <button id="b" onClick={() => toast("Forgot One", "The folder is still on disk.")}>b</button>
    <output id="live">{announcement}</output>
  </>;
}

async function mount() {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ToastProvider><Probe /></ToastProvider>));
  const press = (id: string) => act(async () => host.querySelector<HTMLButtonElement>(`#${id}`)!.click());
  return { host, press, done: async () => { await act(async () => root.unmount()); host.remove(); } };
}

describe("Toast", () => {
  test("confirms in the DS .notice.toast with a title, an optional body and a Dismiss button", async () => {
    const { host, press, done } = await mount();
    expect(host.querySelector(".toast")).toBeNull();
    await press("b");
    const toast = host.querySelector(".notice.toast")!;
    expect(toast.querySelector("strong")?.textContent).toBe("Forgot One");
    expect(toast.querySelector("p")?.textContent).toBe("The folder is still on disk.");
    expect(toast.querySelector("button")?.getAttribute("aria-label")).toBe("Dismiss");
    await done();
  });

  test("shows one at a time: a new toast replaces the one showing", async () => {
    const { host, press, done } = await mount();
    await press("a"); await press("b");
    expect(host.querySelectorAll(".toast")).toHaveLength(1);
    expect(host.querySelector(".toast strong")?.textContent).toBe("Forgot One");
    await done();
  });

  test("Dismiss plays is-leaving for the exit, then removes it", async () => {
    const { host, press, done } = await mount();
    await press("a");
    await act(async () => host.querySelector<HTMLButtonElement>(".toast button")!.click());
    expect(host.querySelector(".toast")!.classList.contains("is-leaving")).toBe(true);
    await wait(220);
    expect(host.querySelector(".toast")).toBeNull();
    await done();
  });

  test("it is the live region (role=status) only where no Island is mounted", async () => {
    const { host, press, done } = await mount();
    await press("a");
    expect(host.querySelector(".toast")!.getAttribute("role")).toBe("status");
    expect(host.querySelector("#live")!.textContent).toBe("");
    await done();
  });

  test("with an Island mounted the toast is silent and its words go out through the Island's region", async () => {
    const island = document.createElement("div"); island.className = "island"; document.body.append(island);
    const { host, press, done } = await mount();
    await press("b");
    expect(host.querySelector(".toast")!.hasAttribute("role")).toBe(false);
    expect(host.querySelector("#live")!.textContent).toBe("Forgot One. The folder is still on disk.");
    await done();
    island.remove();
  });

  test("leaves on its own after a few seconds", async () => {
    const { host, press, done } = await mount();
    await press("a");
    await wait(3700);
    expect(host.querySelector(".toast")).toBeNull();
    await done();
  });
});
