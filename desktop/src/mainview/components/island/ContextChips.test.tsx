import { describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useDom } from "../../test/dom";
import type { ProviderModelId, ReasoningEffort, RuntimeSnapshot, WorkspaceBinding } from "../../../shared/contracts";
import { ContextChips, type ContextChipsProps } from "./ContextChips";

useDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const now = new Date().toISOString();
const snapshot = (over: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot => ({
  revision: 1, status: "ready", credential: { configured: true, verified: true }, providerAuth: null,
  providers: [
    { id: "openrouter", name: "OpenRouter", configured: true, verified: true, availability: "ready" },
    { id: "codex", name: "Codex", configured: true, verified: true, availability: "ready" },
  ],
  models: [
    { id: "openrouter/auto", providerId: "openrouter", rawId: "auto", name: "Auto Router", inputModalities: ["text"], outputModalities: ["text"] },
    { id: "openrouter/plain", providerId: "openrouter", rawId: "plain", name: "Plain", inputModalities: ["text"], outputModalities: ["text"] },
    { id: "codex/sol", providerId: "codex", rawId: "sol", name: "GPT-5.6 Sol", reasoningOptions: ["low", "medium", "high"], inputModalities: ["text"], outputModalities: ["text"] },
    { id: "codex/luna", providerId: "codex", rawId: "luna", name: "GPT-5.6 Luna", reasoningOptions: ["low", "medium", "high"], inputModalities: ["text"], outputModalities: ["text"] },
  ],
  selectedProviderId: "codex", selectedModelId: "codex/sol", selectedReasoningEffort: "medium",
  projects: [{ id: "p1", name: "Proteus", rootPath: "C:\\Code\\Proteus", availability: "ready", createdAt: now, updatedAt: now, lastOpenedAt: now }],
  activeWorkspace: { binding: { kind: "app" }, label: "Proteus workspace", availability: "ready" },
  threads: [], activeThreadId: "t1", retryMessageId: null, messages: [], events: [], interactions: [],
  workbench: { status: "idle", tasks: [], pendingInteractions: [], queuedFollowUpCount: 0, tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
  activeRun: null, continuation: null, error: null, ...over,
});

async function mount(initial: RuntimeSnapshot = snapshot(), extra: Partial<ContextChipsProps> = {}) {
  const calls = { workspace: [] as WorkspaceBinding[], model: [] as ProviderModelId[], effort: [] as (ReasoningEffort | null)[], providers: 0, models: 0, top: 0 };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const props = (value: RuntimeSnapshot): ContextChipsProps => ({
    snapshot: value, queuedDraftCount: 0, runningElsewhere: false, askOpen: false,
    onWorkspaceSelect: async (binding) => { calls.workspace.push(binding); return { accepted: true }; },
    onModelSelect: async (id) => { calls.model.push(id); return true; },
    onReasoningSelect: async (level) => { calls.effort.push(level); return true; },
    onProviders: () => { calls.providers += 1; },
    onModels: () => { calls.models += 1; },
    onTopLevel: () => { calls.top += 1; },
    ...extra,
  });
  const render = (value: RuntimeSnapshot, more: Partial<ContextChipsProps> = {}) => act(async () => root.render(<ContextChips {...props(value)} {...more} />));
  await render(initial);
  const q = <T extends Element>(selector: string) => host.querySelector<T>(selector);
  const qa = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
  const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
  const key = (el: Element | null, k: string) => act(async () => { (el ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });
  const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
  return { host, calls, render, q, qa, click, key, wait, done: () => act(async () => { root.unmount(); host.remove(); }) };
}

const MODEL = 'button[aria-label^="Model "]';
const EFFORT = ".chip-effort";

describe("context chips", () => {
  test("project chip opens the picker, picks a project and returns focus to the chip", async () => {
    const t = await mount();
    const chip = t.q<HTMLButtonElement>(".island-chip:not(.split)")!;
    expect(chip.getAttribute("aria-label")).toBe("Working in Proteus workspace. Change project.");
    await t.click(chip);
    const picker = t.q(".picker.from-start")!;
    expect(picker.closest(".island-anchor")).not.toBeNull();
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    expect(picker.querySelectorAll('[role="radio"]')).toHaveLength(2);
    expect(document.activeElement).toBe(picker.querySelector('[aria-checked="true"]'));
    await t.click(picker.querySelectorAll('[role="radio"]')[1]!);
    expect(t.calls.workspace).toEqual([{ kind: "project", projectId: "p1" }]);
    await t.wait(200);
    expect(t.q(".picker")).toBeNull();
    await t.wait(30);
    expect(document.activeElement).toBe(chip);
    await t.done();
  });

  test("project chip locks after the first message: lock icon, no caret, no picker, a reason in the title", async () => {
    const message = { id: "u", turnId: "t", role: "user" as const, text: "Hi", status: "complete" as const, createdAt: now, parts: [{ id: "p", type: "text" as const, text: "Hi" }] };
    const t = await mount(snapshot({ messages: [message] }));
    const chip = t.q<HTMLButtonElement>(".island-chip:not(.split)")!;
    expect(chip.getAttribute("aria-disabled")).toBe("true");
    expect(chip.getAttribute("title")).toBe("Fixed once a conversation starts");
    expect(chip.querySelector(".chip-caret")).toBeNull();
    expect(chip.querySelector("svg.lucide-lock")).not.toBeNull();
    await t.click(chip);
    expect(t.q(".picker")).toBeNull();
    await t.done();
  });

  test("the model chip is a split group: model name with the provider mark, then the effort part", async () => {
    const t = await mount();
    const group = t.q(".island-chip.split")!;
    expect(group.getAttribute("role")).toBe("group");
    expect(group.querySelectorAll(".chip-part")).toHaveLength(2);
    expect(group.querySelector(".chip-divider")).not.toBeNull();
    expect(group.querySelector(".brand-i")).not.toBeNull();
    expect(group.querySelector(EFFORT)!.textContent).toBe("Medium");
    expect(group.querySelector(".effort-meter")!.className).toBe("effort-meter m-2");
    await t.done();
  });

  test("a model without thinking has no effort part", async () => {
    const t = await mount(snapshot({ selectedProviderId: "openrouter", selectedModelId: "openrouter/plain", selectedReasoningEffort: null }));
    expect(t.q(".island-chip.split")).not.toBeNull();
    expect(t.q(EFFORT)).toBeNull();
    expect(t.q(".chip-divider")).toBeNull();
    await t.done();
  });

  test("the meter ripples at the top level", async () => {
    const t = await mount(snapshot({ selectedReasoningEffort: "high" }));
    expect(t.q(".effort-meter")!.className).toBe("effort-meter m-4 is-max");
    await t.done();
  });

  test("the full picker: head names the provider, radio models, Thinking slider, foot link", async () => {
    const t = await mount();
    await t.click(t.q(MODEL));
    const picker = t.q(".picker.from-end")!;
    expect(picker.querySelector(".kicker")!.textContent).toBe("Model · Codex");
    expect(picker.querySelector(".segmented.sm.icons")).not.toBeNull();
    const tabs = [...picker.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual(["OpenRouter", "Codex"]);
    expect(tabs.map((tab) => tab.getAttribute("title"))).toEqual(["OpenRouter", "Codex"]);
    expect([...picker.querySelectorAll('[role="radio"]')].map((r) => r.querySelector("strong")!.textContent).sort()).toEqual(["GPT-5.6 Luna", "GPT-5.6 Sol"]);
    expect(picker.querySelector(".picker-section input[type=range]")).not.toBeNull();
    expect(picker.querySelector(".picker-foot")!.textContent).toContain("Manage models in Settings");
    await t.click(picker.querySelector(".picker-foot button"));
    expect(t.calls.models).toBe(1);
    await t.done();
  });

  test("provider tabs switch the listed models, and a tab for another provider hides the slider", async () => {
    const t = await mount();
    await t.click(t.q(MODEL));
    const tabs = t.qa('.picker [role="tab"]');
    await t.click(tabs[0]!);
    expect(t.q(".picker .kicker")!.textContent).toBe("Model · OpenRouter");
    expect(t.qa('.picker [role="radio"]').map((r) => r.querySelector("strong")!.textContent).sort()).toEqual(["Auto Router", "Plain"]);
    expect(t.q(".picker input[type=range]")).toBeNull();
    expect(t.qa('.picker [role="tab"]')[0]!.getAttribute("aria-selected")).toBe("true");
    await t.done();
  });

  test("a disconnected provider tab offers Connect, which opens Settings › Providers", async () => {
    const value = snapshot();
    value.providers[0] = { ...value.providers[0]!, verified: false, availability: "needs-configuration" };
    const t = await mount(value);
    await t.click(t.q(MODEL));
    await t.click(t.qa('.picker [role="tab"]')[0]!);
    expect(t.q(".picker .dot.warn")).not.toBeNull();
    await t.click(t.q(".picker .picker-option"));
    expect(t.calls.providers).toBe(1);
    await t.done();
  });

  test("picking a model saves it and closes the picker after the check lands", async () => {
    const t = await mount();
    await t.click(t.q(MODEL));
    const luna = t.qa('.picker [role="radio"]').find((r) => r.textContent!.includes("Luna"))!;
    await t.click(luna);
    expect(t.calls.model).toEqual(["codex/luna"]);
    expect(t.q(".picker")).not.toBeNull();
    for (let i = 0; i < 30 && t.q(".picker"); i += 1) await t.wait(50);
    expect(t.q(".picker")).toBeNull();
    await t.done();
  });

  test("a model that fails to save shows an error and stays open", async () => {
    const t = await mount(snapshot(), { onModelSelect: async () => false });
    await t.click(t.q(MODEL));
    await t.click(t.qa('.picker [role="radio"]').find((r) => r.textContent!.includes("Luna"))!);
    expect(t.q(".picker [role=alert]")!.textContent).toBe("The model selection could not be saved.");
    await t.done();
  });

  test("the compact picker holds only the slider and saves a level", async () => {
    const t = await mount();
    await t.click(t.q(EFFORT));
    const picker = t.q(".picker.compact")!;
    expect(picker.querySelectorAll('[role="radio"]')).toHaveLength(0);
    expect(picker.querySelector(".field-hint")!.textContent).toBe("GPT-5.6 Sol");
    const slider = picker.querySelector<HTMLInputElement>("input[type=range]")!;
    expect(document.activeElement).toBe(slider);
    await t.key(slider, "End");
    expect(t.calls.effort).toEqual(["high"]);
    expect(t.calls.top).toBe(1);
    await t.done();
  });

  test("Escape closes the picker and returns focus to the chip", async () => {
    const t = await mount();
    const chip = t.q<HTMLButtonElement>(MODEL)!;
    await t.click(chip);
    expect(t.q(".picker")).not.toBeNull();
    await t.key(document.activeElement, "Escape");
    await t.wait(200);
    expect(t.q(".picker")).toBeNull();
    expect(document.activeElement).toBe(chip);
    await t.done();
  });

  test("a press outside closes the picker", async () => {
    const t = await mount();
    await t.click(t.q(MODEL));
    await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    await t.wait(200);
    expect(t.q(".picker")).toBeNull();
    await t.done();
  });

  test("arrows, Home and End move through the models", async () => {
    const t = await mount();
    await t.click(t.q(MODEL));
    const radios = t.qa('.picker [role="radio"]');
    const selected = radios.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(document.activeElement).toBe(selected);
    await t.key(selected, "ArrowDown");
    expect(document.activeElement).toBe(radios[(radios.indexOf(selected) + 1) % radios.length]);
    await t.key(document.activeElement, "Home");
    expect(document.activeElement).toBe(radios[0]);
    await t.key(document.activeElement, "End");
    expect(document.activeElement).toBe(radios[radios.length - 1]);
    await t.key(document.activeElement, "ArrowDown");
    expect(document.activeElement).toBe(radios[0]);
    await t.done();
  });

  test("focus is chosen once per opening and not stolen by a re-render while open", async () => {
    const t = await mount();
    await t.click(t.q(MODEL));
    const radios = t.qa('.picker [role="radio"]');
    const other = radios.find((r) => r.getAttribute("aria-checked") !== "true")!;
    other.focus();
    expect(document.activeElement).toBe(other);
    await t.render(snapshot({ revision: 2 }));
    await t.render(snapshot({ revision: 3, selectedReasoningEffort: "high" }));
    expect(document.activeElement).toBe(t.qa('.picker [role="radio"]')[radios.indexOf(other)]);
    await t.done();
  });

  test("ArrowUp on a chip opens its picker", async () => {
    const t = await mount();
    await t.key(t.q(MODEL), "ArrowUp");
    expect(t.q(".picker.from-end")).not.toBeNull();
    await t.done();
  });

  test("the warn chip says Not connected and opens Settings › Providers", async () => {
    const value = snapshot();
    value.providers[1] = { ...value.providers[1]!, verified: false, availability: "needs-configuration" };
    const t = await mount(value);
    const chip = t.q<HTMLButtonElement>(".island-chip.is-warn")!;
    expect(chip.textContent).toBe("Not connected");
    expect(chip.querySelector(".dot")).not.toBeNull();
    expect(t.q(".island-chip.split")).toBeNull();
    await t.click(chip);
    expect(t.calls.providers).toBe(1);
    expect(t.q(".picker")).toBeNull();
    await t.done();
  });

  test("the model chip is disabled while an ask is open and closes an open picker", async () => {
    const t = await mount();
    await t.click(t.q(MODEL));
    expect(t.q(".picker")).not.toBeNull();
    await t.render(snapshot(), { askOpen: true });
    await t.wait(200);
    expect(t.q(".picker")).toBeNull();
    const group = t.q(".island-chip.split")!;
    expect(group.getAttribute("aria-disabled")).toBe("true");
    expect(group.getAttribute("title")).toBe("Answer Proteus first");
    await t.click(t.q(MODEL));
    expect(t.q(".picker")).toBeNull();
    await t.done();
  });
});
