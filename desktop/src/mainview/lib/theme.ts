/** Day/Night theme: stored choice (system | light | dark) resolved against the OS preference. */
export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "proteus.ui.theme";
export const THEME_CANVAS: Record<ResolvedTheme, string> = { light: "#f2f2f4", dark: "#0e0e10" };
const MORPH_FALLBACK_MS = 520;
let shiftTimer: number | undefined;

function morphMs(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--dur-morph").trim();
  const ms = raw.endsWith("ms") ? parseFloat(raw) : raw.endsWith("s") ? parseFloat(raw) * 1000 : NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : MORPH_FALLBACK_MS;
}

export function parseThemeChoice(value: unknown): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  if (choice === "light" || choice === "dark") return choice;
  return systemDark ? "dark" : "light";
}

export function readStoredChoice(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): ThemeChoice {
  try {
    return parseThemeChoice(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function storeChoice(choice: ThemeChoice, storage: Pick<Storage, "setItem" | "removeItem"> | undefined = safeStorage()) {
  try {
    if (choice === "system") storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* storage unavailable: the choice lasts for this session only */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

const darkQuery = () => (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined);
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

let choice: ThemeChoice = "system";
const listeners = new Set<() => void>();

export function getThemeChoice(): ThemeChoice {
  return choice;
}

export function getResolvedTheme(): ResolvedTheme {
  return resolveTheme(choice, darkQuery()?.matches ?? false);
}

/** Write data-theme and the theme-color meta. `animate` adds .theme-shift for one dur-morph. */
function apply(animate: boolean) {
  const root = document.documentElement;
  const next = getResolvedTheme();
  const changed = root.dataset.theme !== next;
  if (changed && animate && !reducedMotion()) {
    root.classList.add("theme-shift");
    window.clearTimeout(shiftTimer);
    shiftTimer = window.setTimeout(() => root.classList.remove("theme-shift"), morphMs());
  }
  root.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_CANVAS[next]);
  listeners.forEach((l) => l());
}

export function setThemeChoice(next: ThemeChoice) {
  choice = next;
  storeChoice(next);
  apply(true);
}

let started = false;
/** Call once at module top, before first render, so the first paint has the right theme. */
export function initTheme() {
  choice = readStoredChoice();
  apply(false);
  if (started) return;
  started = true;
  darkQuery()?.addEventListener("change", () => {
    if (choice === "system") apply(true);
  });
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
