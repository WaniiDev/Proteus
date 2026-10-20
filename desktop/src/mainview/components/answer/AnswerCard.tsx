import { Sparkles } from "lucide-react";
import { AnswerBlockList, type AnswerViewProps } from "./AnswerBody";

/** The answer kept in the thread: the same blocks on the light surface. */
export function AnswerCard({ answer, onIntent, onFollowUp }: AnswerViewProps) {
  return (
    <section className="gen-card" aria-label={answer.title || "Answer"}>
      <div className="gen-card-head"><Sparkles className="i sm" aria-hidden="true" /><span>Answer{answer.title ? ` · ${answer.title}` : ""}</span></div>
      <AnswerBlockList answer={answer} onIntent={onIntent} onFollowUp={onFollowUp} />
    </section>
  );
}
