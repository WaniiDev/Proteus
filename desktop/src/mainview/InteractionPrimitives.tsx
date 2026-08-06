import type { ReactNode } from "react";
import type { PendingInteraction } from "../shared/contracts";

export type InteractionVariant = "plan" | "tool" | "question" | "recovery";

export function interactionVariant(kind: PendingInteraction["kind"], failed = false): InteractionVariant {
  if (failed) return "recovery";
  if (kind === "submit_plan") return "plan";
  if (kind === "tool_approval") return "tool";
  return "question";
}

export function InteractionFrame({ variant, resolving, failed, id, kicker, title, children }: { variant: InteractionVariant; resolving: boolean; failed: boolean; id: string; kicker: string; title: string; children: ReactNode }) {
  return <article className={`interaction-card interaction-variant-${variant}${resolving ? " resolving" : ""}${failed ? " failed" : ""}`} id={id} data-interaction-variant={variant}>
    <div className="interaction-kicker">{kicker}</div>
    <h3>{title}</h3>
    {children}
  </article>;
}

export function InteractionActions({ variant, disabled, primaryLabel, onPrimary, secondaryLabel, onSecondary, primaryDisabled = false }: { variant: InteractionVariant; disabled: boolean; primaryLabel?: string; onPrimary?: () => void; secondaryLabel?: string; onSecondary?: () => void; primaryDisabled?: boolean }) {
  return <div className={`interaction-actions interaction-actions-${variant}`}>
    {secondaryLabel && onSecondary && <button type="button" className="btn-outline sm" disabled={disabled} onClick={onSecondary}>{secondaryLabel}</button>}
    {primaryLabel && onPrimary && <button type="button" className="btn-primary sm" disabled={disabled || primaryDisabled} onClick={onPrimary}>{primaryLabel}</button>}
  </div>;
}
