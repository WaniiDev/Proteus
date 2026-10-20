import type { PendingInteraction } from "../../../../shared/contracts";

export type InteractionVariant = "plan" | "tool" | "question" | "recovery";

export function interactionVariant(kind: PendingInteraction["kind"], failed = false): InteractionVariant {
  if (failed) return "recovery";
  if (kind === "submit_plan") return "plan";
  if (kind === "tool_approval") return "tool";
  return "question";
}

/** Decline on the left (`btn-island-quiet`), the concrete yes on the right (`btn-island`); a pressed yes shows a spinner. */
export function AskActions({ variant, disabled, busy = false, primaryLabel, onPrimary, secondaryLabel, onSecondary, primaryDisabled = false }: { variant: InteractionVariant; disabled: boolean; busy?: boolean; primaryLabel?: string; onPrimary?: () => void; secondaryLabel?: string; onSecondary?: () => void; primaryDisabled?: boolean }) {
  return <div className="island-actions" data-ask-variant={variant}>
    {secondaryLabel && onSecondary && <button type="button" className="btn btn-island-quiet" disabled={disabled} onClick={onSecondary}>{secondaryLabel}</button>}
    {primaryLabel && onPrimary && <button type="button" className="btn btn-island" disabled={disabled || primaryDisabled} aria-busy={busy || undefined} onClick={onPrimary}>{busy && <span className="spinner" aria-hidden="true" />}{primaryLabel}</button>}
  </div>;
}
