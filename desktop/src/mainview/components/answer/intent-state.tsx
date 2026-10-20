import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

/** What the host knows about actions in flight, keyed `${answerId}:${rowId or blockId}`. The outcome itself comes from the snapshot. */
export interface AnswerIntentState {
  pending: ReadonlySet<string>;
  /** Picks the person has made but not confirmed, keyed like `pending`. Omitted: the shared default store holds them. */
  drafts?: DraftPickStore;
  /** The runtime's message for a refused or failed action. The action stays enabled. */
  notes: Readonly<Record<string, string>>;
}

export const answerIntentKey = (answerId: string, targetId: string) => `${answerId}:${targetId}`;

/** A picked-but-unconfirmed choice outlives the block: the answer moves from the Island to the thread and the Choice remounts. */
export interface DraftPickStore {
  get(key: string): string | undefined;
  set(key: string, value: string | undefined): void;
  subscribe(listener: () => void): () => void;
  clear(): void;
}

export function createDraftPickStore(): DraftPickStore {
  const picks = new Map<string, string>();
  const listeners = new Set<() => void>();
  return {
    get: (key) => picks.get(key),
    set: (key, value) => {
      if (value === undefined) picks.delete(key);
      else picks.set(key, value);
      for (const listener of listeners) listener();
    },
    clear: () => {
      picks.clear();
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const defaultDrafts = createDraftPickStore();
/** Forget every draft pick of the shared default store (tests). */
export const resetDraftPicks = () => defaultDrafts.clear();

const EMPTY: AnswerIntentState = { pending: new Set(), notes: {} };
export const AnswerIntentStateContext = createContext<AnswerIntentState>(EMPTY);

export function useIntentState(answerId: string, targetId: string): { pending: boolean; note: string | undefined } {
  const state = useContext(AnswerIntentStateContext);
  const key = answerIntentKey(answerId, targetId);
  return { pending: state.pending.has(key), note: state.notes[key] };
}

/** The draft pick of a choice block; survives the block remounting while the answer settles. */
export function useDraftPick(answerId: string, targetId: string): [string | undefined, (value: string | undefined) => void] {
  const store = useContext(AnswerIntentStateContext).drafts ?? defaultDrafts;
  const key = answerIntentKey(answerId, targetId);
  const value = useSyncExternalStore(store.subscribe, () => store.get(key), () => undefined);
  const set = useCallback((next: string | undefined) => store.set(key, next), [store, key]);
  return [value, set];
}
