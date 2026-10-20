import type { AnswerIntent } from "../../../shared/answer-catalog";

/** What an answer action reports to the host. Routing and policy live in the host (WAN-530), never here. */
export interface AnswerIntentEvent {
  answerId: string;
  /** The block the action belongs to (choice and diff id; the block's own id for row actions is not needed). */
  blockId?: string;
  /** The list or timeline row the action belongs to. */
  rowId?: string;
  intent: AnswerIntent;
  /** The picked option id for `choose`. */
  value?: string;
}

/** Everything a block needs besides its own data. */
export interface AnswerContext {
  answerId: string;
  /** What happened per block or row id ("Approved", "Chosen · ..."). */
  outcomes: Readonly<Record<string, string>>;
  onIntent?: (event: AnswerIntentEvent) => void;
  /** A suggest chip was chosen: the host asks that question next. */
  onFollowUp?: (text: string) => void;
}
