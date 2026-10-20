/** Length of a leave animation (matches --dur-exit); zero when the person prefers reduced motion. */
export const EXIT_MS = 160;

export function exitMs(): number {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : EXIT_MS;
  } catch {
    return EXIT_MS;
  }
}
