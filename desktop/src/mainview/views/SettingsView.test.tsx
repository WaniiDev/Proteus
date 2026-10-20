import { describe, expect, mock, test } from "bun:test";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { buildFixture } from "../../../preview/fixtures";
import { useDom } from "../test/dom";
import type { SettingsSection } from "./SettingsView";

// The Memory and Developer tabs reach the Electrobun bridge, which does not load under bun test.
mock.module("../lib/bridge", () => ({ rpc: { request: new Proxy({}, { get: () => async () => new Promise(() => undefined) }) } }));
const { SettingsView } = await import("./SettingsView");

useDom();

const noop = () => undefined;
const props = (section: SettingsSection) => ({
  snapshot: buildFixture("settings"), section, onSection: noop, apiKey: "", setApiKey: noop, onConnect: noop, onDisconnect: noop,
  onStartCodexAuth: noop, onSubmitCodexAuth: noop, onCancelCodexAuth: noop, onRefresh: noop, onSelectProvider: noop, onSelectModel: noop, onSelectReasoning: noop,
});

describe("SettingsView", () => {
  test("renders the page head and four tabs (Memory is its own page) with the current one selected", () => {
    const html = renderToStaticMarkup(<SettingsView {...props("providers")} />);
    expect(html).toContain('<h1 class="heading">Settings</h1>');
    expect(html).toContain("seg-n-4 seg-at-0");
    for (const label of ["Providers", "Models", "Appearance", "Developer"]) expect(html).toContain(`>${label}</button>`);
    expect(html).not.toContain(">Memory</button>");
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("Provider · 1 of 2 connected");
  });

  test("Models: a select, a radio list with the chosen model checked, and the thinking row", () => {
    const html = renderToStaticMarkup(<SettingsView {...props("models")} />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Reasoning effort");
    expect(html).toContain('type="range"');
  });

  test("Models: row sub is note · mono id, no MODELS FROM label, Refresh stays reachable, effort sub points at the Island", () => {
    const html = renderToStaticMarkup(<SettingsView {...props("models")} />);
    expect(html).toContain('<span class="mono">');
    expect(html).not.toContain("Models from");
    expect(html).toContain("Refresh models");
    expect(html).toContain("Each chat can change it from the Island.");
    expect(html).not.toContain("Prompt —");
    expect(html).not.toContain("Completion —");
  });

  test("Models: during a run the rows and the slider are disabled and the row sub gives the reason", () => {
    const snapshot = buildFixture("settings");
    const running = { ...snapshot, activeRun: { ...buildFixture("running").activeRun! } };
    const html = renderToStaticMarkup(<SettingsView {...props("models")} snapshot={running} />);
    const rows = html.match(/<button[^>]*role="radio"[^>]*>/g) ?? [];
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) expect(row).toContain("disabled");
    expect(html).toContain("model-row");
    expect(html).toMatch(/<input[^>]*type="range"[^>]*disabled/);
    expect(html).toContain("settings-effort is-locked");
    expect(html).toContain("Locked until the current run finishes.");
    expect(html).toContain("Models can change once the current run finishes.");
    const idle = renderToStaticMarkup(<SettingsView {...props("models")} />);
    expect(idle).not.toMatch(/<input[^>]*type="range"[^>]*disabled/);
  });

  test("Models: a model without adjustable thinking says so", () => {
    const snapshot = buildFixture("settings");
    const other = { ...snapshot, models: snapshot.models.map((model) => (model.id === snapshot.selectedModelId ? { ...model, reasoningOptions: undefined } : model)) };
    const html = renderToStaticMarkup(<SettingsView {...props("models")} snapshot={other} />);
    expect(html).toContain("This model doesn’t offer adjustable thinking.");
    expect(html).not.toContain('type="range"');
  });

  test("Appearance: System, Day and Night, wired to the theme choice", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<SettingsView {...props("appearance")} />));
    const tabs = Array.from(host.querySelectorAll<HTMLElement>('[aria-label="Theme"] [role="tab"]'));
    expect(tabs.map((t) => t.textContent)).toEqual(["System", "Day", "Night"]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    await act(async () => tabs[2]!.click());
    expect(host.querySelector('[aria-label="Theme"]')!.className).toContain("seg-at-2");
    await act(async () => tabs[0]!.click());
    await act(async () => root.unmount());
    host.remove();
  });

  test("switching tabs: the thumb moves at once, the old body fades, then the next rises in", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    function Harness() {
      const [section, setSection] = useState<SettingsSection>("providers");
      return <SettingsView {...props(section)} section={section} onSection={setSection} />;
    }
    const root = createRoot(host);
    await act(async () => root.render(<Harness />));
    const tab = (name: string) => Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]')).find((t) => t.textContent === name)!;
    await act(async () => tab("Appearance").click());
    expect(host.querySelector(".segmented")!.className).toContain("seg-at-2");
    expect(host.querySelector(".settings-body")!.className).toContain("is-leaving");
    expect(host.textContent).toContain("Provider · ");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
    expect(host.querySelector(".settings-body")!.className).not.toContain("is-leaving");
    expect(host.textContent).toContain("Theme");
    expect(host.textContent).not.toContain("Provider · ");
    await act(async () => root.unmount());
    host.remove();
  });

  test("Models: the radio list is one tab stop and arrows, Home and End move and select", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const onSelectModel = mock((_id: string) => undefined);
    const root = createRoot(host);
    await act(async () => root.render(<SettingsView {...props("models")} onSelectModel={onSelectModel} />));
    const radios = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(radios().length).toBeGreaterThan(1);
    const stops = radios().filter((radio) => radio.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]!.getAttribute("aria-checked")).toBe("true");
    const press = async (key: string) => act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
    const count = radios().length;
    await act(async () => stops[0]!.focus());
    await press("End");
    expect(document.activeElement).toBe(radios()[count - 1]!);
    expect(onSelectModel).toHaveBeenCalledTimes(1);
    await press("Home");
    expect(document.activeElement).toBe(radios()[0]!);
    await press("ArrowUp");
    expect(document.activeElement).toBe(radios()[count - 1]!);
    await press("ArrowRight");
    expect(document.activeElement).toBe(radios()[0]!);
    await press("ArrowDown");
    expect(document.activeElement).toBe(radios()[1]!);
    expect(onSelectModel).toHaveBeenCalledTimes(5);
    await act(async () => root.unmount());
    host.remove();
  });
});
