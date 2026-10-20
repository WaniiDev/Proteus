import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ChatAnswerPart, ChatEvent, InteractionResponseResult, OrbState, RuntimeSnapshot, ThreadSummary } from "../../shared/contracts";
import { rpc } from "../lib/bridge";
import { askQueue } from "../lib/ask-copy";
import { groupConversationItems } from "../lib/ui-helpers";
import { ConversationMenu } from "../components/ConversationMenu";
import { selectedProviderCanChat, type QueuedDraft } from "../lib/composer-ui";
import { Composer } from "../components/Composer";
import { Icon } from "../components/Icon";
import type { OrbHandle } from "../components/Orb";
import { OrbPresence } from "../components/OrbPresence";
import { exitMs } from "../components/ds/motion";
import { useFocusingMoment } from "../ds-app/focusing";
import { reducedMotion } from "../ds-app/lens";
import { ensureSurgeLayer } from "../ds-app/surge";
import { PersistentOrbSurface } from "../components/PersistentOrbSurface";
import { useConversationOrbState } from "../hooks/useConversationOrbState";
import { useSmartScroll } from "../hooks/useSmartScroll";
import { AssistantTurn } from "../components/AssistantTurn";
import { AnswerBody, type AnswerIntentEvent } from "../components/answer";
import type { IslandHandle } from "../components/island/Island";
import { AskBody } from "../components/island/asks/AskBody";
import { StoppedNote } from "../components/ResolvedLine";
import { QueuedMessageBubble } from "../components/QueuedMessageBubble";

const HERO_PROMPTS = ["What needs me this morning?", "Compare the three launch options", "How did sign-ups trend this week?"];

function exitBeatMs(): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dur-exit"));
  return Number.isFinite(value) ? value : 160;
}

export function Companion({ snapshot, activeTitle, input, setInput, queuedDrafts, transportError, onTransportRetry, onSend, onAbort, onSettings, onProviders, onModels, onProjects, onOrbState, onRetry, onContinue, onInteraction, onInteractionDismiss, onToolApproval, onIntent, onFollowUp, onRename, onPin, onDeleteRequest, threadLeaving = false }: { snapshot: RuntimeSnapshot; activeTitle: string; input: string; setInput: (value: string) => void; queuedDrafts: QueuedDraft[]; transportError: string | null; onTransportRetry: () => void; onSend: (event: FormEvent<HTMLFormElement>) => void; onAbort: () => void; onSettings: () => void; onProviders?: () => void; onModels?: () => void; onProjects?: () => void; onOrbState: (state: OrbState) => void; onRetry: (messageId: string) => void; onContinue: (messageId: string) => void; onInteraction: (toolCallId: string, response: unknown) => Promise<InteractionResponseResult>; onInteractionDismiss: (toolCallId: string) => Promise<InteractionResponseResult>; onToolApproval: (toolCallId: string, approved: boolean, fingerprint: string) => Promise<InteractionResponseResult>; /** An action inside an answer. The intent RPC is wired by the host. */ onIntent?: (event: AnswerIntentEvent) => unknown; onFollowUp?: (text: string) => void; /** The header menu's conversation actions, the same handlers the sidebar gets. */ onRename?: (threadId: string, title: string) => void; onPin?: (threadId: string, pinned: boolean) => void; onDeleteRequest?: (thread: ThreadSummary) => void; /** The exit beat of a conversation swap: the thread fades up before the next one rises. */ threadLeaving?: boolean }) {
  const runningForSelected = snapshot.activeRun?.status === "running" && snapshot.activeRun.threadId === snapshot.activeThreadId;
  const runningElsewhere = snapshot.activeRun?.status === "running" && !runningForSelected;
  const selectedModel = snapshot.models.find((model) => model.id === snapshot.selectedModelId);
  const effectiveProviderId = selectedModel?.providerId ?? snapshot.selectedProviderId;
  const selectedProvider = snapshot.providers.find((provider) => provider.id === effectiveProviderId);
  const canChat = selectedProviderCanChat(snapshot) && !runningElsewhere;
  const { state, pulseVersion } = useConversationOrbState(snapshot);
  const orbRef = useRef<OrbHandle>(null);
  const [heroOrbAnchor, setHeroOrbAnchor] = useState<HTMLDivElement | null>(null);
  const [dockOrbAnchor, setDockOrbAnchor] = useState<HTMLDivElement | null>(null);
  const heroOrbAnchorRef = useCallback((element: HTMLDivElement | null) => setHeroOrbAnchor(element), []);
  const dockOrbAnchorRef = useCallback((element: HTMLDivElement | null) => setDockOrbAnchor(element), []);
  const [dockedThreads, setDockedThreads] = useState<Set<string>>(() => new Set());
  const lastMessage = snapshot.messages[snapshot.messages.length - 1];
  const { threadRef, showLatest, jumpLatest } = useSmartScroll(`${snapshot.activeThreadId ?? "none"}:${lastMessage?.id ?? "none"}:${lastMessage?.text.length ?? 0}`, snapshot.activeThreadId ?? "none");
  const viewRef = useRef<HTMLElement>(null);
  const stageBodyRef = useRef<HTMLDivElement>(null);
  // Max thinking is a moment on the orb and the stage: it never plays during a run or under reduced motion (see ds-app/focusing.ts).
  const { onTopLevel } = useFocusingMoment({
    orb: () => orbRef.current,
    surgeLayer: () => (viewRef.current ? ensureSurgeLayer(viewRef.current) : null),
    origin: () => (docked ? dockOrbAnchor : heroOrbAnchor),
    stage: () => stageBodyRef.current,
    runActive: snapshot.activeRun !== null,
  });
  useEffect(() => {
    onOrbState(state);
  }, [onOrbState, state]);
  useEffect(() => {
    if (!snapshot.activeThreadId || (!snapshot.messages.length && !snapshot.activeRun)) return;
    setDockedThreads((current) => (current.has(snapshot.activeThreadId as string) ? current : new Set(current).add(snapshot.activeThreadId as string)));
  }, [snapshot.activeRun, snapshot.messages.length, snapshot.activeThreadId]);
  const docked = !!snapshot.activeThreadId && (snapshot.messages.length > 0 || !!snapshot.activeRun || dockedThreads.has(snapshot.activeThreadId));
  // The greeting exits in two beats on the first send: it fades up (.view.is-leaving) while the hero anchor stays measurable for the orb's flight.
  const [heroLeaving, setHeroLeaving] = useState(false);
  const [dockSeen, setDockSeen] = useState({ docked, threadId: snapshot.activeThreadId });
  if (dockSeen.docked !== docked || dockSeen.threadId !== snapshot.activeThreadId) {
    setDockSeen({ docked, threadId: snapshot.activeThreadId });
    if (!dockSeen.docked && docked && (dockSeen.threadId === snapshot.activeThreadId || dockSeen.threadId === null) && !reducedMotion()) setHeroLeaving(true);
    else if (!docked || dockSeen.threadId !== snapshot.activeThreadId) setHeroLeaving(false);
  }
  useEffect(() => {
    if (!heroLeaving) return undefined;
    const timer = window.setTimeout(() => setHeroLeaving(false), exitBeatMs());
    return () => window.clearTimeout(timer);
  }, [heroLeaving]);
  const showHero = !docked || heroLeaving;
  const animateDock = !!snapshot.activeThreadId && runningForSelected && !dockedThreads.has(snapshot.activeThreadId);
  const lastErrorMessage = [...snapshot.messages].reverse().find((message) => message.status === "error");
  const retryTarget = snapshot.retryMessageId ?? lastErrorMessage?.id;
  const conversationItems = useMemo(() => groupConversationItems(snapshot.messages), [snapshot.messages]);
  const pendingToolIds = useMemo(() => new Set(snapshot.interactions.map((item) => item.toolCallId)), [snapshot.interactions]);
  const islandRef = useRef<IslandHandle>(null);
  const asks = useMemo(() => askQueue(snapshot.interactions, snapshot.activeThreadId), [snapshot.interactions, snapshot.activeThreadId]);
  // The latest turn's answer stays in the Island while it streams and until the person settles it (Done or a new send).
  const [dismissedAnswers, setDismissedAnswers] = useState<Set<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState("");
  const lastItem = conversationItems.at(-1);
  const latestAnswer = lastItem?.type === "assistant" ? lastItem.parts.filter((part): part is ChatAnswerPart => part.type === "answer").at(-1) : undefined;
  const liveAnswer = latestAnswer && (latestAnswer.streaming || !dismissedAnswers.has(latestAnswer.answerId)) ? latestAnswer : null;
  // Done: the card waits for the Island body's exit (--dur-exit), then mounts and rises in.
  const liveAnswerId = liveAnswer?.answerId ?? null;
  const [heldAnswerId, setHeldAnswerId] = useState<string | null>(liveAnswerId);
  useEffect(() => {
    if (liveAnswerId) {
      setHeldAnswerId(liveAnswerId);
      return undefined;
    }
    const timer = window.setTimeout(() => setHeldAnswerId(null), exitMs());
    return () => window.clearTimeout(timer);
  }, [liveAnswerId]);
  const settleAnswer = useCallback(() => {
    if (!liveAnswer) return;
    setDismissedAnswers((current) => new Set(current).add(liveAnswer.answerId));
  }, [liveAnswer]);
  const handleFollowUp = (text: string) => {
    settleAnswer();
    onFollowUp?.(text);
  };
  // An approved action pulses the orb and sends the wave, like an Island approval.
  const handleIntent = async (event: AnswerIntentEvent) => {
    const approved = await onIntent?.(event);
    if (approved === true && event.intent === "approve") { islandRef.current?.wave(); orbRef.current?.pulse(); }
  };
  const handleSend = (event: FormEvent<HTMLFormElement>) => {
    settleAnswer();
    onSend(event);
  };
  const body: ReactNode = asks[0]
    ? <AskBody key={asks[0].id} interaction={asks[0]} onRespond={onInteraction} onApproval={onToolApproval} onDismiss={onInteractionDismiss} onApproved={() => { islandRef.current?.wave(); orbRef.current?.pulse(); }} onResubmit={(messageId) => rpc.request["chat.retry"]({ messageId }).then((result) => result.accepted).catch(() => false)} />
    : liveAnswer
      ? <AnswerBody key={liveAnswer.answerId} answer={liveAnswer} onAnnounce={setAnnouncement} onIntent={handleIntent} onFollowUp={handleFollowUp} />
      : null;
  // The body fades out before the Island settles, so keep the last one in place for the exit.
  const lastBody = useRef<ReactNode>(null);
  if (body) lastBody.current = body;
  const [bodyExpired, setBodyExpired] = useState(false);
  const hasBody = body !== null;
  useEffect(() => {
    if (hasBody) {
      setBodyExpired(false);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      lastBody.current = null;
      setBodyExpired(true);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [hasBody]);
  const shownBody = body ?? (bodyExpired ? null : lastBody.current);
  return (
    <section className="companion-view" ref={viewRef}>
      <div className="companion-drag window-drag-region electrobun-webkit-app-region-drag" aria-hidden="true" />
      {docked && (
        <header className={threadLeaving ? "conv-header view is-leaving" : "conv-header view"} key={`header:${snapshot.activeThreadId}`}>
          <h1 className="conv-title">{activeTitle}</h1>
          <span className="badge">{snapshot.activeWorkspace.label}</span>
          <ConversationMenu snapshot={snapshot} onRename={onRename} onPin={onPin} onDeleteRequest={onDeleteRequest} />
        </header>
      )}
      <PersistentOrbSurface state={state} docked={docked} animateDock={animateDock} pulseVersion={pulseVersion} orbRef={orbRef} heroAnchor={heroOrbAnchor} dockAnchor={dockOrbAnchor} />
      <div className="text-chat-layout">
        <div className="companion-grid">
          <div className="stage">
            <div className="stage-body" ref={stageBodyRef}>
            {runningElsewhere && <div className="other-run-note">Another conversation is running. You can browse this chat while it finishes.</div>}
            {showHero && (
              <OrbPresence state={state} anchorRef={heroOrbAnchorRef} leaving={heroLeaving}>
                <h2 className="display-xl hero-title">Hi. What’s on your mind?</h2>
                <p className="hero-lede">Type below. When I need a yes from you, I’ll ask right here — nothing moves without it.</p>
                <div className="hero-tiles">
                  {HERO_PROMPTS.map((prompt) => (
                    <button type="button" className="tile enter" key={prompt} onClick={() => setInput(prompt)}><span className="tile-dot" />{prompt}</button>
                  ))}
                </div>
              </OrbPresence>
            )}
            <div className={threadLeaving ? "thread view is-leaving" : "thread view"} ref={threadRef} key={`thread:${snapshot.activeThreadId}`}>
              {conversationItems.map((item) =>
                item.type === "user" ? (
                  <div className="turn-user" key={`user:${item.message.id}`}>
                    <div className="bubble">{item.message.text}</div>
                  </div>
                ) : (
                  <AssistantTurn key={`turn:${item.id}`} messages={item.messages} parts={item.parts} pendingIds={pendingToolIds} tasks={snapshot.workbench.tasks} onRetry={onRetry} onContinue={onContinue} openAnswerId={liveAnswerId ?? heldAnswerId} onIntent={handleIntent} onFollowUp={handleFollowUp} />
                ),
              )}
              {queuedDrafts.map((draft) => <QueuedMessageBubble key={draft.id} draft={draft} />)}
              {snapshot.events.map((event: ChatEvent) => (
                <div className="chat-event" key={event.id}>
                  {event.text}
                </div>
              ))}
              {snapshot.continuation && snapshot.continuation.threadId === snapshot.activeThreadId && snapshot.continuation.phase !== "resuming" && (
                <div className="notice warn">
                  <div>
                    <strong>{snapshot.continuation.phase === "slow" ? "Still continuing…" : "Checking the latest run state…"}</strong>
                    <p>{snapshot.continuation.phase === "slow" ? "Proteus has not reported new progress yet." : "Proteus is reconciling this decision with Mastra’s durable run history."}</p>
                  </div>
                  <button type="button" className="btn btn-secondary sm" onClick={onAbort}><Icon name="stop" size={13} /> Stop</button>
                </div>
              )}
              {transportError && (
                <div className="notice error">
                  <div>
                    <strong>Desktop connection needs attention.</strong>
                    <p>{transportError}</p>
                  </div>
                  <button type="button" className="btn btn-secondary sm" onClick={onTransportRetry}>
                    <Icon name="retry" size={14} /> Reconnect
                  </button>
                </div>
              )}
              {snapshot.error && snapshot.error.code !== "aborted" && (
                <div className="notice error">
                  <div>
                    <strong>That turn did not finish.</strong>
                    <p>{snapshot.error.message}</p>
                  </div>
                  {snapshot.error.retryable && retryTarget && (
                    <button type="button" className="btn btn-secondary sm" onClick={() => onRetry(retryTarget)}>
                      <Icon name="retry" size={14} /> Retry
                    </button>
                  )}
                </div>
              )}
              {snapshot.error?.code === "aborted" && lastMessage?.status !== "interrupted" && <StoppedNote />}
              {showLatest && (
                <button type="button" className="btn btn-glass sm latest-btn" onClick={jumpLatest}>
                  <Icon name="latest" size={14} /> Latest
                </button>
              )}
            </div>
            </div>
            <Composer
              snapshot={snapshot}
              input={input}
              queuedDraftCount={queuedDrafts.length}
              canChat={canChat}
              runningForSelected={runningForSelected}
              runningElsewhere={runningElsewhere}
              providerName={selectedProvider?.name ?? "a provider"}
              orbState={state}
              docked={docked}
              orbAnchorRef={dockOrbAnchorRef}
              onInput={setInput}
              open={hasBody}
              body={shownBody}
              bodyScroll
              islandRef={islandRef}
              answer={!asks[0] && liveAnswer ? { streaming: liveAnswer.streaming, question: liveAnswer.question || liveAnswer.title } : null}
              announcement={announcement}
              onDone={settleAnswer}
              onSubmit={handleSend}
              onAbort={onAbort}
              onSettings={onSettings}
              onProviders={onProviders}
              onModels={onModels}
              onProjects={onProjects}
              onTopLevel={onTopLevel}
              onNudge={() => orbRef.current?.nudge()}
              onWorkspaceSelect={(workspaceBinding) => rpc.request["threads.workspace.select"]({ workspaceBinding })}
              onModelSelect={(modelId) => rpc.request["models.select"]({ modelId }).then((result) => result.accepted)}
              onReasoningSelect={(reasoningEffort) => rpc.request["models.reasoning.select"]({ reasoningEffort }).then((result) => result.accepted)}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
