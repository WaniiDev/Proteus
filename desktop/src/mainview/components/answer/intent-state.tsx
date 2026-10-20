import { createContext, useContext } from "react";

/** What the host knows about actions in flight, keyed `${answerId}:${rowId or blockId}`. The outcome itself comes from the snapshot. */
export interface AnswerIntentState {
  pending: ReadonlySet<string>;
  /** The runtime's message for a refused or failed action. The action stays enabled. */
  notes: Readonly<Record<string, string>>;
}

export const answerIntentKey = (answerId: string, targetId: string) => `${answerId}:${targetId}`;

const EMPTY: AnswerIntentState = { pending: new Set(), notes: {} };
export const AnswerIntentStateContext = createContext<AnswerIntentState>(EMPTY);

export function useIntentState(answerId: string, targetId: string): { pending: boolean; note: string | undefined } {
  const state = useContext(AnswerIntentStateContext);
  const key = answerIntentKey(answerId, targetId);
  return { pending: state.pending.has(key), note: state.notes[key] };
}
