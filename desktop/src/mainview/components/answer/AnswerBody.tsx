import { useEffect, useRef, useState } from "react";
import type { ChatAnswerPart } from "../../../shared/contracts";
import { AnswerBlockView } from "./AnswerBlocks";
import type { AnswerContext, AnswerIntentEvent } from "./types";

export interface AnswerViewProps {
  answer: ChatAnswerPart;
  onIntent?: (event: AnswerIntentEvent) => void;
  onFollowUp?: (text: string) => void;
}

export interface AnswerBodyProps extends AnswerViewProps {
  /**
   * Receives the one live-region message: "Answering" when streaming starts, "Answer ready" when it ends.
   * Without it the body renders its own visually hidden status; the Island passes it to route into its own region.
   */
  onAnnounce?: (message: string) => void;
}

export const ANSWER_STREAMING_MESSAGE = "Answering";
export const ANSWER_READY_MESSAGE = "Answer ready";

/** The announcement for a streaming flag, once per change: nothing for an answer that was already done. */
export function useAnswerAnnouncement(streaming: boolean, onAnnounce?: (message: string) => void): string {
  const [message, setMessage] = useState(streaming ? ANSWER_STREAMING_MESSAGE : "");
  const previous = useRef<boolean | undefined>(undefined);
  const callback = useRef(onAnnounce);
  callback.current = onAnnounce;
  useEffect(() => {
    if (previous.current === streaming) return;
    const next = streaming ? ANSWER_STREAMING_MESSAGE : previous.current === undefined ? "" : ANSWER_READY_MESSAGE;
    previous.current = streaming;
    setMessage(next);
    if (next) callback.current?.(next);
  }, [streaming]);
  return message;
}

/** The `.gen` block list, with `.gen-more` holding the next block's place while streaming. */
export function AnswerBlockList({ answer, onIntent, onFollowUp }: AnswerViewProps) {
  const ctx: AnswerContext = { answerId: answer.answerId, outcomes: answer.outcomes, onIntent, onFollowUp };
  return (
    <div className="gen">
      {answer.blocks.map((block, index) => <AnswerBlockView block={block} ctx={ctx} key={index} />)}
      {answer.streaming && <div className="gen-more" aria-label="Still answering"><i /><i /><i /></div>}
    </div>
  );
}

/** The Island's answer body. The Island supplies `.island-body-inner.gen-scroll` around it. */
export function AnswerBody({ onAnnounce, ...view }: AnswerBodyProps) {
  const message = useAnswerAnnouncement(view.answer.streaming, onAnnounce);
  return (
    <>
      {!onAnnounce && <div className="sr-only" role="status" aria-live="polite">{message}</div>}
      <AnswerBlockList {...view} />
    </>
  );
}
