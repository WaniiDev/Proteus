import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { InteractionResponseResult, PendingInteraction } from "../../shared/contracts";
import { interactionSubmissionUi, type InteractionSubmissionAction } from "../lib/interaction-ui";
import { InteractionActions, InteractionFrame, interactionVariant } from "./InteractionPrimitives";

export function InteractionCard({ interaction, onRespond, onApproval, onResubmit, onDismiss }: { interaction: PendingInteraction; onRespond: (toolCallId: string, response: unknown) => Promise<InteractionResponseResult>; onApproval: (toolCallId: string, approved: boolean) => Promise<InteractionResponseResult>; onResubmit: (messageId: string) => Promise<boolean>; onDismiss: (toolCallId: string) => Promise<InteractionResponseResult> }) {
  const [answer, setAnswer] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [otherSelected, setOtherSelected] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [submittingAction, setSubmittingAction] = useState<InteractionSubmissionAction>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const isPlan = interaction.kind === "submit_plan";
  const isApproval = interaction.kind === "tool_approval";
  const failed = interaction.status === "failed";
  const submissionUi = interactionSubmissionUi(interaction.kind, interaction.status, submittingAction);
  const resolving = submissionUi.resolving;
  const variant = interactionVariant(interaction.kind, failed);
  const send = async (response: unknown, action: Exclude<InteractionSubmissionAction, null>) => {
    if (resolving) return;
    setSubmittingAction(action);
    setLocalError(null);
    const result = await onRespond(interaction.toolCallId, response).catch(() => ({ accepted: false as const, code: "resume-failed" as const, message: "The response could not be sent.", retryable: true }));
    if (!result.accepted) {
      setLocalError(result.message);
      setSubmittingAction(null);
    }
  };
  const decideApproval = async (approved: boolean) => {
    if (resolving) return;
    setSubmittingAction(approved ? "approve" : "reject");
    setLocalError(null);
    const result = await onApproval(interaction.toolCallId, approved).catch(() => ({ accepted: false as const, code: "resume-failed" as const, message: "The tool decision could not be sent.", retryable: true }));
    if (!result.accepted) {
      setLocalError(result.message);
      setSubmittingAction(null);
    }
  };
  const submit = () => void send(
    isPlan
      ? { action: "approved", feedback: feedback.trim() || undefined }
      : interaction.options.length > 0 && otherSelected
        ? { kind: "other", value: answer.trim(), ...(interaction.selectionMode === "multi_select" ? { selections: selected } : {}) }
        : interaction.options.length > 0 && interaction.selectionMode === "multi_select"
          ? selected
          : interaction.options.length > 0
            ? (selected[0] ?? "")
            : answer.trim(),
    isPlan ? "approve" : "answer",
  );
  const toggle = (label: string) => setSelected((current) => (current.includes(label) ? current.filter((value) => value !== label) : [...current, label]));
  return (
    <InteractionFrame variant={variant} resolving={resolving} failed={failed} id={`interaction-${interaction.id}`} kicker={submissionUi.kicker ?? (failed ? "Response failed" : isPlan ? "Plan approval" : isApproval ? "Tool approval" : "Your input needed")} title={interaction.title}>
      {interaction.question && <p>{interaction.question}</p>}
      {isApproval && (
        <details className="approval-details">
          <summary>{interaction.argsSummary ?? "Review exact tool arguments"}</summary>
          <pre className="tool-approval-args">{JSON.stringify(interaction.args ?? null, null, 2)}</pre>
          {interaction.fingerprint && <small>Request fingerprint: {interaction.fingerprint}</small>}
        </details>
      )}
      {isPlan && interaction.plan && (
        <div className="plan-preview">
          <strong>{interaction.plan.title}</strong>
          {interaction.plan.raw ? (
            <div className="plan-markdown markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{interaction.plan.raw}</ReactMarkdown>
            </div>
          ) : (
            <>
              <p>{interaction.plan.summary}</p>
              {interaction.plan.steps.length > 0 && (
                <ol>
                  {interaction.plan.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      )}
      {!failed && !isPlan && !isApproval && interaction.options.length > 0 && (
        <div className={`interaction-options ${interaction.selectionMode === "multi_select" ? "multi" : ""}`}>
          {interaction.options.map((option) => (
            <label key={option.label} className={`interaction-option${selected.includes(option.label) ? " selected" : ""}`}>
              <input disabled={resolving} type={interaction.selectionMode === "multi_select" ? "checkbox" : "radio"} name={interaction.id} checked={selected.includes(option.label)} onChange={() => {
                if (interaction.selectionMode === "multi_select") toggle(option.label);
                else {
                  setSelected([option.label]);
                  setOtherSelected(false);
                }
              }} />
              <span>
                <b>{option.label}</b>
                {option.description && <small>{option.description}</small>}
              </span>
            </label>
          ))}
          <label className={`interaction-option interaction-option-other${otherSelected ? " selected" : ""}`}>
            <input disabled={resolving} type={interaction.selectionMode === "multi_select" ? "checkbox" : "radio"} name={interaction.id} checked={otherSelected} onChange={() => {
              if (interaction.selectionMode === "multi_select") setOtherSelected((current) => !current);
              else {
                setSelected([]);
                setOtherSelected(true);
              }
            }} />
            <span>
              <b>Other</b>
              <small>Type your own answer</small>
            </span>
          </label>
        </div>
      )}
      {!failed && !isPlan && !isApproval && interaction.options.length > 0 && otherSelected && <textarea autoFocus disabled={resolving} className="interaction-input interaction-other-input" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Type your own answer…" rows={2} />}
      {!failed && !isPlan && !isApproval && interaction.options.length === 0 && <textarea disabled={resolving} className="interaction-input" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Type your answer…" rows={2} />}
      {!failed && isPlan && <textarea disabled={resolving} className="interaction-input" value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Optional feedback or requested changes" rows={2} />}
      {(localError || interaction.error) && <p className="interaction-error" role="alert">{localError ?? interaction.error?.message}</p>}
      <InteractionActions
        variant={variant}
        disabled={resolving}
        secondaryLabel={failed ? "Dismiss" : isApproval || isPlan ? submissionUi.rejectLabel : undefined}
        onSecondary={failed
          ? () => void onDismiss(interaction.toolCallId)
          : isApproval
            ? () => void decideApproval(false)
            : isPlan
              ? () => void send({ action: "rejected", feedback: feedback.trim() || "Please revise the plan." }, "reject")
              : undefined}
        primaryLabel={failed ? (interaction.originMessageId ? "Resubmit turn" : undefined) : submissionUi.approveLabel}
        onPrimary={failed
          ? interaction.originMessageId ? () => void onResubmit(interaction.originMessageId as string) : undefined
          : isApproval ? () => void decideApproval(true) : submit}
        primaryDisabled={!failed && !isPlan && !isApproval && (interaction.options.length > 0 ? (otherSelected ? !answer.trim() : selected.length === 0) : !answer.trim())}
      />
    </InteractionFrame>
  );
}
