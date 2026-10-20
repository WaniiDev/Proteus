import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { PanelRight } from "lucide-react";
import type { ChatEvent, InteractionResponseResult, OrbState, RuntimeSnapshot } from "../../shared/contracts";
import { ORB_STATES } from "../orb/orb-spec";
import { rpc } from "../lib/bridge";
import { groupConversationItems } from "../lib/ui-helpers";
import { ContextPane, type ContextPaneTab } from "../components/ContextPane";
import { selectedProviderCanChat, type QueuedDraft } from "../lib/composer-ui";
import { Composer } from "../components/Composer";
import { Icon } from "../components/Icon";
import type { OrbHandle } from "../components/Orb";
import { OrbPresence } from "../components/OrbPresence";
import { PersistentOrbSurface } from "../components/PersistentOrbSurface";
import { useConversationOrbState } from "../hooks/useConversationOrbState";
import { useSmartScroll } from "../hooks/useSmartScroll";
import { MessageActions } from "../components/MessageActions";
import { AssistantTurn } from "../components/AssistantTurn";
import { InteractionCard } from "../components/InteractionCard";
import { StoppedNote } from "../components/ResolvedLine";
import { QueuedMessageBubble } from "../components/QueuedMessageBubble";

export function Companion({ snapshot, activeTitle, input, setInput, queuedDrafts, transportError, onTransportRetry, onSend, onAbort, onSettings, onOrbState, onRetry, onContinue, onInteraction, onInteractionDismiss, onToolApproval }: { snapshot: RuntimeSnapshot; activeTitle: string; input: string; setInput: (value: string) => void; queuedDrafts: QueuedDraft[]; transportError: string | null; onTransportRetry: () => void; onSend: (event: FormEvent<HTMLFormElement>) => void; onAbort: () => void; onSettings: () => void; onOrbState: (state: OrbState) => void; onRetry: (messageId: string) => void; onContinue: (messageId: string) => void; onInteraction: (toolCallId: string, response: unknown) => Promise<InteractionResponseResult>; onInteractionDismiss: (toolCallId: string) => Promise<InteractionResponseResult>; onToolApproval: (toolCallId: string, approved: boolean) => Promise<InteractionResponseResult> }) {
  const runningForSelected = snapshot.activeRun?.status === "running" && snapshot.activeRun.threadId === snapshot.activeThreadId;
  const runningElsewhere = snapshot.activeRun?.status === "running" && !runningForSelected;
  const selectedModel = snapshot.models.find((model) => model.id === snapshot.selectedModelId);
  const effectiveProviderId = selectedModel?.providerId ?? snapshot.selectedProviderId;
  const selectedProvider = snapshot.providers.find((provider) => provider.id === effectiveProviderId);
  const canChat = selectedProviderCanChat(snapshot) && snapshot.activeThreadId !== null && !runningElsewhere;
  const { state, pulseVersion } = useConversationOrbState(snapshot);
  const orbRef = useRef<OrbHandle>(null);
  const [heroOrbAnchor, setHeroOrbAnchor] = useState<HTMLDivElement | null>(null);
  const [dockOrbAnchor, setDockOrbAnchor] = useState<HTMLDivElement | null>(null);
  const heroOrbAnchorRef = useCallback((element: HTMLDivElement | null) => setHeroOrbAnchor(element), []);
  const dockOrbAnchorRef = useCallback((element: HTMLDivElement | null) => setDockOrbAnchor(element), []);
  const contextToggleRef = useRef<HTMLButtonElement>(null);
  const [contextOpenByThread, setContextOpenByThread] = useState<Map<string, boolean>>(() => new Map());
  const [contextTabByThread, setContextTabByThread] = useState<Map<string, ContextPaneTab>>(() => new Map());
  const [dockedThreads, setDockedThreads] = useState<Set<string>>(() => new Set());
  const lastMessage = snapshot.messages[snapshot.messages.length - 1];
  const { threadRef, showLatest, jumpLatest } = useSmartScroll(`${snapshot.activeThreadId ?? "none"}:${lastMessage?.id ?? "none"}:${lastMessage?.text.length ?? 0}:${snapshot.interactions.length}`);
  const contextOpen = !!snapshot.activeThreadId && contextOpenByThread.get(snapshot.activeThreadId) === true;
  const contextTab = snapshot.activeThreadId ? contextTabByThread.get(snapshot.activeThreadId) ?? "activity" : "activity";
  const workbenchAttention = snapshot.workbench.pendingInteractions.filter((item) => item.status === "pending" || item.status === "resolving").length;
  useEffect(() => {
    onOrbState(state);
  }, [onOrbState, state]);
  useEffect(() => {
    if (!snapshot.activeThreadId || (!snapshot.messages.length && !snapshot.activeRun)) return;
    setDockedThreads((current) => (current.has(snapshot.activeThreadId as string) ? current : new Set(current).add(snapshot.activeThreadId as string)));
  }, [snapshot.activeRun, snapshot.messages.length, snapshot.activeThreadId]);
  useEffect(() => {
    if (!contextOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (snapshot.activeThreadId) setContextOpenByThread((current) => new Map(current).set(snapshot.activeThreadId as string, false));
      requestAnimationFrame(() => contextToggleRef.current?.focus());
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [contextOpen, snapshot.activeThreadId]);
  const docked = !!snapshot.activeThreadId && (snapshot.messages.length > 0 || !!snapshot.activeRun || dockedThreads.has(snapshot.activeThreadId));
  const animateDock = !!snapshot.activeThreadId && runningForSelected && !dockedThreads.has(snapshot.activeThreadId);
  const lastErrorMessage = [...snapshot.messages].reverse().find((message) => message.status === "error");
  const retryTarget = snapshot.retryMessageId ?? lastErrorMessage?.id;
  const conversationItems = useMemo(() => groupConversationItems(snapshot.messages), [snapshot.messages]);
  const pendingToolIds = useMemo(() => new Set(snapshot.interactions.map((item) => item.toolCallId)), [snapshot.interactions]);
  const jumpToInteraction = (id: string) => {
    document.getElementById(`interaction-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  return (
    <section className="view active companion-view">
      <div className="chat-titlebar window-drag-region electrobun-webkit-app-region-drag">
        <div className="chat-title-copy">
          {docked && <OrbPresence state={state} docked anchorRef={dockOrbAnchorRef} />}
          <div className="chat-title-text">
            <h1 className="chat-title">{activeTitle}</h1>
            <div className="chat-title-meta"><span className="orb-state-inline">{ORB_STATES[state].label}</span><span aria-hidden="true">·</span><span className={`workspace-badge ${snapshot.activeWorkspace.availability}`}>{snapshot.activeWorkspace.label}</span></div>
          </div>
        </div>
        <button ref={contextToggleRef} type="button" className={`workbench-toggle electrobun-webkit-app-region-no-drag${contextOpen ? " active" : ""}`} aria-label={contextOpen ? "Close context" : "Open context"} aria-expanded={contextOpen} aria-controls="conversation-context" disabled={!snapshot.activeThreadId} onClick={() => { if (!snapshot.activeThreadId) return; setContextOpenByThread((current) => new Map(current).set(snapshot.activeThreadId as string, !contextOpen)); }}><PanelRight size={16} /><span>Context</span>{workbenchAttention > 0 && <b>{workbenchAttention}</b>}</button>
      </div>
      <PersistentOrbSurface state={state} docked={docked} animateDock={animateDock} pulseVersion={pulseVersion} orbRef={orbRef} heroAnchor={heroOrbAnchor} dockAnchor={dockOrbAnchor} />
      <div className="text-chat-layout">
        <div className={`companion-grid ${contextOpen ? "context-present" : "context-absent"}`}>
          <div className="stage">
            {runningElsewhere && <div className="other-run-note">Another conversation is running. You can browse this chat while it finishes.</div>}
            {!docked && <OrbPresence state={state} docked={false} anchorRef={heroOrbAnchorRef} />}
            {!docked && <section className="command-home-copy" aria-label="Start with Proteus">
              <span className="caption-uppercase">Your thinking companion</span>
              <h2>What can we work on?</h2>
              <p>Start with a question, a folder, or a result you want to make real.</p>
              <div className="command-home-prompts">
                <button type="button" onClick={() => setInput("Help me explore this project and identify the most important next step.")}>Explore a project</button>
                <button type="button" onClick={() => setInput("Help me turn an idea into a clear, reviewable plan.")}>Shape a plan</button>
                <button type="button" onClick={() => setInput("Research a question with sources and summarize what matters.")}>Research a question</button>
              </div>
            </section>}
            <div className="thread" ref={threadRef} aria-live="polite">
              {conversationItems.map((item) =>
                item.type === "user" ? (
                  <div className="turn-user" key={item.message.id}>
                    <div className="bubble">{item.message.text}</div>
                    <MessageActions message={item.message} />
                  </div>
                ) : (
                  <AssistantTurn key={item.id} messages={item.messages} parts={item.parts} pendingIds={pendingToolIds} tasks={snapshot.workbench.tasks} onRetry={onRetry} onContinue={onContinue} />
                ),
              )}
              {queuedDrafts.map((draft) => <QueuedMessageBubble key={draft.id} draft={draft} />)}
              {snapshot.events.map((event: ChatEvent) => (
                <div className="chat-event" key={event.id}>
                  {event.text}
                </div>
              ))}
              {snapshot.continuation && snapshot.continuation.threadId === snapshot.activeThreadId && snapshot.continuation.phase !== "resuming" && (
                <div className={`continuation-notice continuation-${snapshot.continuation.phase}`} role="status">
                  <div>
                    <strong>{snapshot.continuation.phase === "slow" ? "Still continuing…" : "Checking the latest run state…"}</strong>
                    <p>{snapshot.continuation.phase === "slow" ? "Proteus has not reported new progress yet." : "Proteus is reconciling this decision with Mastra’s durable run history."}</p>
                  </div>
                  <button type="button" className="btn-outline sm" onClick={onAbort}><Icon name="stop" size={13} /> Stop</button>
                </div>
              )}
              {snapshot.interactions.map((interaction) => <InteractionCard key={interaction.id} interaction={interaction} onRespond={onInteraction} onApproval={onToolApproval} onDismiss={onInteractionDismiss} onResubmit={(messageId) => rpc.request["chat.retry"]({ messageId }).then((result) => result.accepted).catch(() => false)} />)}
              {transportError && (
                <div className="run-error-card transport-error-card">
                  <div>
                    <strong>Desktop connection needs attention.</strong>
                    <p>{transportError}</p>
                  </div>
                  <button type="button" className="btn-outline sm" onClick={onTransportRetry}>
                    <Icon name="retry" size={14} /> Reconnect
                  </button>
                </div>
              )}
              {snapshot.error && snapshot.error.code !== "aborted" && (
                <div className="run-error-card">
                  <div>
                    <strong>That turn did not finish.</strong>
                    <p>{snapshot.error.message}</p>
                  </div>
                  {snapshot.error.retryable && retryTarget && (
                    <button type="button" className="btn-outline sm" onClick={() => onRetry(retryTarget)}>
                      <Icon name="retry" size={14} /> Retry
                    </button>
                  )}
                </div>
              )}
              {snapshot.error?.code === "aborted" && lastMessage?.status !== "interrupted" && <StoppedNote />}
              {showLatest && (
                <button type="button" className="latest-btn" onClick={jumpLatest}>
                  <Icon name="latest" size={14} /> Latest
                </button>
              )}
            </div>
            <Composer
              snapshot={snapshot}
              input={input}
              queuedDraftCount={queuedDrafts.length}
              canChat={canChat}
              runningForSelected={runningForSelected}
              runningElsewhere={runningElsewhere}
              providerName={selectedProvider?.name ?? "a provider"}
              onInput={setInput}
              onSubmit={onSend}
              onAbort={onAbort}
              onSettings={onSettings}
              onNudge={() => orbRef.current?.nudge()}
              onWorkspaceSelect={(workspaceBinding) => rpc.request["threads.workspace.select"]({ workspaceBinding })}
              onModelSelect={(modelId) => rpc.request["models.select"]({ modelId }).then((result) => result.accepted)}
              onReasoningSelect={(reasoningEffort) => rpc.request["models.reasoning.select"]({ reasoningEffort }).then((result) => result.accepted)}
            />
          </div>
          {contextOpen && (
            <button
              type="button"
              className="context-backdrop"
              aria-label="Close context pane"
              onClick={() => {
                if (!snapshot.activeThreadId) return;
                setContextOpenByThread((current) => new Map(current).set(snapshot.activeThreadId as string, false));
                requestAnimationFrame(() => contextToggleRef.current?.focus());
              }}
            />
          )}
          {contextOpen && <ContextPane snapshot={snapshot} tab={contextTab} onTabChange={(tab) => {
            if (snapshot.activeThreadId) setContextTabByThread((current) => new Map(current).set(snapshot.activeThreadId as string, tab));
          }} onJump={jumpToInteraction} onClose={() => {
            if (!snapshot.activeThreadId) return;
            setContextOpenByThread((current) => new Map(current).set(snapshot.activeThreadId as string, false));
            requestAnimationFrame(() => contextToggleRef.current?.focus());
          }} />}
        </div>
      </div>
    </section>
  );
}
