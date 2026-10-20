import { useSyncExternalStore } from "react";
import { getResolvedTheme, getThemeChoice, setThemeChoice, subscribeTheme } from "../lib/theme";

/** Current theme choice (System, Day, Night), the resolved theme, and the setter for the Appearance control. */
export function useTheme() {
  const choice = useSyncExternalStore(subscribeTheme, getThemeChoice);
  const resolved = useSyncExternalStore(subscribeTheme, getResolvedTheme);
  return { choice, resolved, setChoice: setThemeChoice };
}
