import { reasoningEfforts, type ReasoningEffort } from "../../shared/contracts";

export const EFFORT_COPY: Record<ReasoningEffort, { name: string; hint: string }> = {
  none: { name: "Off", hint: "Answers right away, without thinking first." },
  minimal: { name: "Minimal", hint: "Barely pauses before answering." },
  low: { name: "Low", hint: "A quick think before answering." },
  medium: { name: "Medium", hint: "Thinks when it helps. A good default." },
  high: { name: "High", hint: "Thinks carefully. Slower, and uses more tokens." },
  xhigh: { name: "Extra high", hint: "Thinks at length. Slower still." },
  max: { name: "Max", hint: "Thinks as long as it needs. Slowest, and uses the most tokens." },
  ultra: { name: "Ultra", hint: "The deepest thinking this model offers. Slowest of all, and the most tokens." },
};

export const NO_ADJUSTABLE_THINKING = "This model doesn’t offer adjustable thinking.";

export function effortName(level: ReasoningEffort): string {
  return EFFORT_COPY[level].name;
}

export function effortHint(level: ReasoningEffort): string {
  return EFFORT_COPY[level].hint;
}

/** A model's levels in runtime order, deduplicated; empty when it offers none. */
export function orderedLevels(levels: readonly ReasoningEffort[] | undefined): ReasoningEffort[] {
  const set = new Set(levels ?? []);
  return reasoningEfforts.filter((level) => set.has(level));
}

/** The level `want` maps to among `levels`: itself when offered, otherwise the nearest (ties go lower). Null when none. */
export function nearestLevel(levels: readonly ReasoningEffort[], want: ReasoningEffort | null | undefined): ReasoningEffort | null {
  const offered = orderedLevels(levels);
  if (!offered.length) return null;
  if (!want) return offered[0];
  if (offered.includes(want)) return want;
  const target = reasoningEfforts.indexOf(want);
  let best = offered[0];
  for (const level of offered) {
    if (Math.abs(reasoningEfforts.indexOf(level) - target) < Math.abs(reasoningEfforts.indexOf(best) - target)) best = level;
  }
  return best;
}

/** Index of `value` (mapped to the nearest offered level) within `levels`; -1 when there are no levels. */
export function levelIndex(levels: readonly ReasoningEffort[], value: ReasoningEffort | null | undefined): number {
  const nearest = nearestLevel(levels, value);
  return nearest ? orderedLevels(levels).indexOf(nearest) : -1;
}

/** True when `index` is the model's top level (needs at least two levels to be a distinct moment). */
export function isTopLevel(count: number, index: number): boolean {
  return count > 1 && index === count - 1;
}

export function effortValueText(level: ReasoningEffort, top: boolean): string {
  return top ? `${effortName(level)}, the most this model can think` : effortName(level);
}

/** Chip meter step (0-4) for a level index. */
export function meterStep(count: number, index: number): number {
  return count > 1 ? Math.round((index / (count - 1)) * 4) : 0;
}
