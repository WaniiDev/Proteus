import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { InteractionResponseResult, PendingInteraction } from "../../../../shared/contracts";
import { interactionSubmissionUi, type InteractionSubmissionAction } from "../../../lib/interaction-ui";
import { approveLabel, askCode, askSentence, askTitle } from "../../../lib/ask-copy";
import { markdownComponents } from "../../MarkdownCode";
import { AskActions, interactionVariant } from "./AskPrimitives";

/** Commands run through Mastra's LocalSandbox with isolation "none": the approval says so (HANDOFF, mastra-runtime.md). */
export const HOST_EXECUTION_NOTE = "On Windows this runs on your machine without a sandbox.";
const HOST_EXECUTION_TOOLS = new Set(["mastra_workspace_execute_command"]);

export type AskHandlers = {
  onRespond: (toolCallId: string, response: unknown) => Promise<InteractionResponseResult>;
  /** The fingerprint travels with the decision: the runtime refuses an approval for a request that changed. */
  onApproval: (toolCallId: string, approved: boolean, fingerprint: string) => Promise<InteractionResponseResult>;
  onResubmit: (messageId: string) => Promise<boolean>;
  onDismiss: (toolCallId: string) => Promise<InteractionResponseResult>;
  /** An approval or a plan approval was accepted: the Island pulses the orb and sends the wave. */
  onApproved?: () => void;
};

/**
 * The body of the open ask, inside `.island-body-inner`: it returns a fragment so every row is a direct child and rises in turn.
 * Key it by interaction id: a new ask starts clean and takes focus once. Focus lands on the title (or the field of an open question),
 * never on a button, so Enter cannot approve by accident.
 */
export function AskBody({ interaction, onRespond, onApproval, onResubmit, onDismiss, onApproved }: { interaction: PendingInteraction } & AskHandlers) {
  const [answer, setAnswer] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [otherSelected, setOtherSelected] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [submittingAction, setSubmittingAction] = useState<InteractionSubmissionAction>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const isPlan = interaction.kind === "submit_plan";
  const isApproval = interaction.kind === "tool_approval";
  const failed = interaction.status === "failed";
  const multi = interaction.selectionMode === "multi_select";
  const hasOptions = interaction.options.length > 0;
  const submissionUi = interactionSubmissionUi(interaction.kind, interaction.status, submittingAction, approveLabel(interaction));
  const resolving = submissionUi.resolving;
  const variant = interactionVariant(interaction.kind, failed);
  const sentence = askSentence(interaction);
  const code = askCode(interaction);
  const steps = isPlan ? interaction.plan?.steps ?? [] : [];
  const planText = isPlan && steps.length === 0 ? interaction.plan?.raw : undefined;

  // Focus moves into the ask once, when it opens.
  useEffect(() => {
    const target = !failed && !isApproval && !isPlan && !hasOptions ? fieldRef.current : titleRef.current;
    target?.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const settle = async (request: Promise<InteractionResponseResult>, action: Exclude<InteractionSubmissionAction, null>, fallback: string, approved: boolean) => {
    if (resolving) return;
    setSubmittingAction(action);
    setLocalError(null);
    const result = await request.catch((): InteractionResponseResult => ({ accepted: false, code: "resume-failed", message: fallback, retryable: true }));
    if (result.accepted) {
      if (approved) onApproved?.();
      return;
    }
    setLocalError(result.message);
    setSubmittingAction(null);
  };
  const send = (response: unknown, action: Exclude<InteractionSubmissionAction, null>, approved = false) =>
    settle(onRespond(interaction.toolCallId, response), action, "The response could not be sent.", approved);
  const decideApproval = (approved: boolean) =>
    settle(onApproval(interaction.toolCallId, approved, interaction.fingerprint ?? ""), approved ? "approve" : "reject", "The tool decision could not be sent.", approved);
  const submit = () => void send(
    isPlan
      ? { action: "approved", feedback: feedback.trim() || undefined }
      : hasOptions && otherSelected
        ? { kind: "other", value: answer.trim(), ...(multi ? { selections: selected } : {}) }
        : hasOptions && multi
          ? selected
          : hasOptions
            ? (selected[0] ?? "")
            : answer.trim(),
    isPlan ? "approve" : "answer",
    isPlan,
  );
  const toggle = (label: string) => setSelected((current) => (current.includes(label) ? current.filter((value) => value !== label) : [...current, label]));
  const optionType = multi ? "checkbox" : "radio";

  return (
    <>
      <h2 className="island-title" id={`interaction-${interaction.id}`} tabIndex={-1} ref={titleRef}>{askTitle(interaction)}</h2>
      {sentence && <p className="island-text">{sentence}</p>}
      {code && <pre className="island-code">{code}</pre>}
      {steps.length > 0 && <ol className="island-steps">{steps.map((step, index) => <li key={`${index}:${step}`}>{step}</li>)}</ol>}
      {planText && <div className="reply"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{planText}</ReactMarkdown></div>}
      {!failed && !isPlan && !isApproval && hasOptions && (
        <div className="island-options" role={multi ? "group" : "radiogroup"} aria-label={interaction.question ?? interaction.title}>
          {interaction.options.map((option) => (
            <label key={option.label} className="island-option">
              <input disabled={resolving} type={optionType} name={interaction.id} checked={selected.includes(option.label)} onChange={() => {
                if (multi) toggle(option.label);
                else {
                  setSelected([option.label]);
                  setOtherSelected(false);
                }
              }} />
              <span>{option.label}{option.description && <small>{option.description}</small>}</span>
            </label>
          ))}
          <label className="island-option">
            <input disabled={resolving} type={optionType} name={interaction.id} checked={otherSelected} onChange={() => {
              if (multi) setOtherSelected((current) => !current);
              else {
                setSelected([]);
                setOtherSelected(true);
              }
            }} />
            <span>Other…<small>Type your own answer</small></span>
          </label>
        </div>
      )}
      {!failed && !isPlan && !isApproval && hasOptions && otherSelected && <input ref={fieldRef} autoFocus disabled={resolving} className="island-field" aria-label="Your own answer" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Type your own answer…" />}
      {!failed && !isPlan && !isApproval && !hasOptions && <textarea ref={fieldRef} disabled={resolving} className="island-field" aria-label={interaction.question ?? interaction.title} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Type your answer…" rows={2} />}
      {!failed && isPlan && <textarea disabled={resolving} className="island-field" aria-label="Optional feedback or requested changes" value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Optional feedback or requested changes" rows={2} />}
      {isApproval && !failed && HOST_EXECUTION_TOOLS.has(interaction.toolName ?? "") && <p className="island-note">{HOST_EXECUTION_NOTE}</p>}
      {(localError || interaction.error) && !failed && <p className="island-note">{localError ?? interaction.error?.message}</p>}
      {failed && localError && <p className="island-note">{localError}</p>}
      <AskActions
        variant={variant}
        disabled={resolving}
        busy={submittingAction === "approve" || submittingAction === "answer"}
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
        primaryDisabled={!failed && !isPlan && !isApproval && (hasOptions ? (otherSelected ? !answer.trim() : selected.length === 0) : !answer.trim())}
      />
    </>
  );
}
