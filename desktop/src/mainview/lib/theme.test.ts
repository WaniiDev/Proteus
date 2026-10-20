import { describe, expect, test } from "bun:test";
import { useDom } from "../test/dom";
import { initTheme, parseThemeChoice, readStoredChoice, resolveTheme, setThemeChoice, storeChoice, THEME_CANVAS, THEME_STORAGE_KEY } from "./theme";

useDom();

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe("theme resolution", () => {
  test("a stored choice beats the system preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  test("system follows the OS", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
  test("unknown stored values fall back to system", () => {
    expect(parseThemeChoice("purple")).toBe("system");
    expect(parseThemeChoice(null)).toBe("system");
  });
  test("choice persists and system clears it", () => {
    const s = memory();
    storeChoice("dark", s);
    expect(s.m.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(readStoredChoice(s)).toBe("dark");
    storeChoice("system", s);
    expect(readStoredChoice(s)).toBe("system");
  });
  test("throwing storage degrades to system", () => {
    expect(readStoredChoice({ getItem: () => { throw new Error("blocked"); } })).toBe("system");
  });
});

describe("initTheme in the DOM", () => {
  const dark = { matches: false, listeners: new Set<() => void>() };
  const reduced = { matches: false };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const root = () => document.documentElement;
  const osSwitch = (matches: boolean) => { dark.matches = matches; dark.listeners.forEach((l) => l()); };

  const setup = (stored?: string) => {
    localStorage.clear();
    if (stored) localStorage.setItem(THEME_STORAGE_KEY, stored);
    root().removeAttribute("data-theme");
    root().classList.remove("theme-shift");
    root().style.setProperty("--dur-morph", "30ms");
    document.head.querySelector('meta[name="theme-color"]')?.remove();
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "";
    document.head.append(meta);
    dark.matches = false;
    reduced.matches = false;
    (globalThis as { matchMedia?: unknown }).matchMedia = (query: string) =>
      query.includes("reduced-motion")
        ? reduced
        : { get matches() { return dark.matches; }, addEventListener: (_: string, l: () => void) => void dark.listeners.add(l) };
    window.matchMedia = globalThis.matchMedia;
    initTheme();
    return meta;
  };

  test("follows a live OS switch while on System", () => {
    const meta = setup();
    expect(root().dataset.theme).toBe("light");
    expect(meta.content).toBe(THEME_CANVAS.light);
    osSwitch(true);
    expect(root().dataset.theme).toBe("dark");
    expect(meta.content).toBe("#0e0e10");
    osSwitch(false);
    expect(root().dataset.theme).toBe("light");
    expect(meta.content).toBe("#f2f2f4");
  });

  test("a stored choice ignores OS switches", () => {
    setup("light");
    osSwitch(true);
    expect(root().dataset.theme).toBe("light");
    setup("dark");
    osSwitch(false);
    expect(root().dataset.theme).toBe("dark");
  });

  test("adds .theme-shift for one dur-morph, then removes it", async () => {
    setup("light");
    setThemeChoice("dark");
    expect(root().classList.contains("theme-shift")).toBe(true);
    await sleep(10);
    expect(root().classList.contains("theme-shift")).toBe(true);
    await sleep(60);
    expect(root().classList.contains("theme-shift")).toBe(false);
  });

  test("a second switch restarts the timer instead of clearing early", async () => {
    setup("light");
    setThemeChoice("dark");
    await sleep(20);
    setThemeChoice("light");
    await sleep(20);
    expect(root().classList.contains("theme-shift")).toBe(true);
    await sleep(40);
    expect(root().classList.contains("theme-shift")).toBe(false);
  });

  test("skips .theme-shift under reduced motion", async () => {
    setup("light");
    reduced.matches = true;
    setThemeChoice("dark");
    expect(root().dataset.theme).toBe("dark");
    expect(root().classList.contains("theme-shift")).toBe(false);
  });

  test("the first paint does not animate", () => {
    setup("dark");
    expect(root().classList.contains("theme-shift")).toBe(false);
  });
});
