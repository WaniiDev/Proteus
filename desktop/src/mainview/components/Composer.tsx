import type { FormEvent, ReactNode, Ref } from "react";
import type {
  OrbState,
  ProviderModelId,
  ReasoningEffort,
  RuntimeSnapshot,
  WorkspaceBinding,
  WorkspaceBindingUpdateResult,
} from "../../shared/contracts";
import { deriveIsland } from "../lib/composer-ui";
import { ContextChips } from "./island/ContextChips";
import { Island, type IslandHandle } from "./island/Island";

type ComposerProps = {
  snapshot: RuntimeSnapshot;
  input: string;
  queuedDraftCount: number;
  canChat: boolean;
  runningForSelected: boolean;
  runningElsewhere: boolean;
  providerName: string;
  orbState: OrbState;
  /** The conversation has started: the Island's orb slot is open and the orb docks there. */
  docked: boolean;
  orbAnchorRef: (element: HTMLDivElement | null) => void;
  /** The Island grows upward while open; `body` fills it (ask and answer bodies). */
  open?: boolean;
  body?: ReactNode;
  bodyScroll?: boolean;
  islandRef?: Ref<IslandHandle>;
  /** An answer is open in the Island: the words beside the orb and the question. Done settles it. */
  answer?: { streaming: boolean; question: string } | null;
  announcement?: string;
  onDone?: () => void;
  onInput: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onAbort: () => void;
  onSettings: () => void;
  /** Settings › Providers, Settings › Models and Projects; each falls back to `onSettings` (Projects is hidden without one). */
  onProviders?: () => void;
  onModels?: () => void;
  onProjects?: () => void;
  /** Thinking arrived at the model's top level: the focusing moment. */
  onTopLevel?: () => void;
  onNudge: () => void;
  onWorkspaceSelect: (binding: WorkspaceBinding) => Promise<WorkspaceBindingUpdateResult>;
  onModelSelect: (modelId: ProviderModelId) => Promise<boolean>;
  onReasoningSelect: (effort: ReasoningEffort | null) => Promise<boolean>;
};

export function Composer({
  snapshot,
  input,
  queuedDraftCount,
  canChat,
  runningForSelected,
  runningElsewhere,
  providerName,
  orbState,
  docked,
  orbAnchorRef,
  open,
  body,
  bodyScroll,
  islandRef,
  answer,
  announcement,
  onDone,
  onInput,
  onSubmit,
  onAbort,
  onSettings,
  onProviders,
  onModels,
  onProjects,
  onTopLevel,
  onNudge,
  onWorkspaceSelect,
  onModelSelect,
  onReasoningSelect,
}: ComposerProps) {
  const island = deriveIsland({ snapshot, orbState, input, canChat, runningForSelected, runningElsewhere, providerName, queuedDraftCount, answer });
  const chips = (
    <ContextChips
      snapshot={snapshot}
      queuedDraftCount={queuedDraftCount}
      runningElsewhere={runningElsewhere}
      askOpen={island.mode === "ask"}
      onWorkspaceSelect={onWorkspaceSelect}
      onModelSelect={onModelSelect}
      onReasoningSelect={onReasoningSelect}
      onProviders={onProviders ?? onSettings}
      onModels={onModels ?? onSettings}
      onProjects={onProjects}
      onTopLevel={onTopLevel}
    />
  );

  return (
    <Island
      ref={islandRef}
      orbState={orbState}
      docked={docked}
      orbAnchorRef={orbAnchorRef}
      mode={island.mode}
      end={island.end}
      status={island.status}
      askKind={island.askKind}
      answerLabel={island.answerLabel}
      answerLine={island.answerLine}
      announcement={announcement}
      onDone={onDone}
      input={input}
      placeholder={island.placeholder}
      inputDisabled={island.inputDisabled}
      sendLabel={island.sendLabel}
      sendDisabled={island.sendDisabled}
      onInput={onInput}
      onSubmit={onSubmit}
      onStop={onAbort}
      onNudge={onNudge}
      open={open}
      body={body}
      bodyScroll={bodyScroll}
      meta={chips}
    />
  );
}
