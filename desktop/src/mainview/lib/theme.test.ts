import { describe, expect, test } from "bun:test";
import { parseThemeChoice, readStoredChoice, resolveTheme, storeChoice, THEME_STORAGE_KEY } from "./theme";

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
