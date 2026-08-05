import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ComponentPropsWithoutRef, type MutableRefObject, type ReactNode } from "react";
import { ArrowDown, ArrowRight, Check, ChevronDown, Copy, KeyRound, PanelRight, Pencil, Play, Plus, RefreshCw, RotateCcw, Search, Send, Square, Trash2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatEvent, ChatMessage, ChatToolPart, InteractionResponseResult, ProviderModel, OrbState, PendingInteraction, RuntimeError, RuntimeSnapshot, RuntimeSnapshotEnvelope, ToolApproval, ThreadSummary } from "../shared/contracts";
import { ORB_STATES } from "./orb-spec";
import { mountOrb, type OrbFX } from "./orb3d";
import { rpc } from "./bridge";
import { decodeRuntimeSnapshot } from "../shared/runtime-snapshot-codec";
import { groupConversationItems, groupThreads, relativeTime, shouldShowWorkbench } from "./ui-helpers";
import { interactionSubmissionUi, type InteractionSubmissionAction } from "./interaction-ui";
import { deriveOrbSteadyState, recoveryGate } from "./orb-state";
import { Sidebar, type View } from "./Sidebar";
import { ToolTimeline } from "./ToolTimeline";
import { Workbench } from "./Workbench";
import { composerAction, composerLineCount, reconcileQueuedDrafts, selectedProviderCanChat, shouldSubmitComposerKey, type QueuedDraft } from "./composer-ui";

const DEFAULT_SNAPSHOT: RuntimeSnapshot = {
  revision: 0,
  status: "booting",
  credential: { configured: false, verified: false },
  providers: [
    { id: "openrouter", name: "OpenRouter", configured: false, verified: false, availability: "needs-configuration" },
    { id: "codex", name: "Codex", configured: true, verified: false, availability: "checking" },
  ],
  models: [
    {
      id: "openrouter/auto",
      providerId: "openrouter",
      rawId: "auto",
      name: "Auto Router",
      inputModalities: ["text"],
      outputModalities: ["text"],
    },
  ],
  selectedProviderId: "openrouter",
  selectedModelId: "openrouter/auto",
  selectedReasoningEffort: null,
  threads: [],
  activeThreadId: null,
  retryMessageId: null,
  messages: [],
  events: [],
  interactions: [],
  toolApproval: null,
  workbench: {
    status: "idle",
    tasks: [],
    pendingInteractions: [],
    queuedFollowUpCount: 0,
    tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  },
  activeRun: null,
  error: null,
};

type IconName = "send" | "stop" | "down" | "plus" | "trash" | "refresh" | "key" | "edit" | "copy" | "retry" | "play" | "close" | "latest" | "steer" | "search" | "check" | "panel";

const ICONS = {
  send: Send,
  stop: Square,
  down: ChevronDown,
  plus: Plus,
  trash: Trash2,
  refresh: RefreshCw,
  key: KeyRound,
  edit: Pencil,
  copy: Copy,
  retry: RotateCcw,
  play: Play,
  close: X,
  latest: ArrowDown,
  steer: ArrowRight,
  search: Search,
  check: Check,
  panel: PanelRight,
} satisfies Record<IconName, typeof Send>;

function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  const Glyph = ICONS[name];
  return <Glyph className={className} size={size} strokeWidth={1.75} aria-hidden="true" />;
}

export type OrbHandle = { pulse: () => void; nudge: () => void };

const Orb = forwardRef<OrbHandle, { state: OrbState }>(function Orb({ state }, ref) {
  const floatRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<OrbFX | null>(null);
  useLayoutEffect(() => {
    if (!floatRef.current || !canvasRef.current) return undefined;
    const controller = mountOrb(floatRef.current, canvasRef.current);
    controllerRef.current = controller;
    controller.setState(state);
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      pulse: () => controllerRef.current?.pulse(),
      nudge: () => controllerRef.current?.nudge(),
    }),
    [],
  );
  useEffect(() => {
    controllerRef.current?.setState(state);
  }, [state]);
  return (
    <div className="orb-float" ref={floatRef} data-state={state}>
      <div className="orb-shadow" aria-hidden="true" />
      <canvas className="orb-canvas" ref={canvasRef} aria-hidden="true" />
      <div className="orb-css" aria-hidden="true">
        <div className="orb-layer l0" />
        <div className="orb-layer l1" />
        <div className="orb-swirl" />
        <div className="orb-sheen" />
      </div>
      <div className="orb-ring r1" aria-hidden="true" />
      <div className="orb-ring r2" aria-hidden="true" />
      <div className="orb-ring r3" aria-hidden="true" />
      <div className="orb-orbit" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
});

function ConversationPopover({ snapshot, open, disabled, initialEditingId, onClose, onCreate, onSwitch, onRename, onDelete }: { snapshot: RuntimeSnapshot; open: boolean; disabled: boolean; initialEditingId?: string | null; onClose: () => void; onCreate: () => void; onSwitch: (threadId: string) => void; onRename: (threadId: string, title: string) => void; onDelete: (thread: ThreadSummary) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const groups = useMemo(() => groupThreads(snapshot.threads, query), [query, snapshot.threads]);
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);
  useEffect(() => {
    if (!open || !initialEditingId) return;
    const thread = snapshot.threads.find((item) => item.id === initialEditingId);
    if (thread && !disabled) {
      setEditingId(thread.id);
      setEditValue(thread.title);
    }
  }, [disabled, initialEditingId, open, snapshot.threads]);
  if (!open) return null;
  const beginEdit = (thread: ThreadSummary) => {
    if (disabled) return;
    setEditingId(thread.id);
    setEditValue(thread.title);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };
  const saveEdit = (thread: ThreadSummary) => {
    const next = editValue.trim().slice(0, 80);
    if (next && next !== thread.title) onRename(thread.id, next);
    cancelEdit();
  };
  return (
    <div className="conversation-popover" ref={rootRef} role="dialog" aria-label="Conversation history">
      <div className="conversation-popover-head">
        <div>
          <span className="caption-uppercase">Conversations</span>
          <p>Saved on this device</p>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => {
            onCreate();
            onClose();
          }}
          disabled={disabled}
          aria-label="New chat"
          title={disabled ? "Available when the current response finishes" : "New chat"}
        >
          <Icon name="plus" size={17} />
        </button>
      </div>
      <label className="conversation-search">
        <Icon name="search" size={15} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
      </label>
      <div className="conversation-popover-list">
        {groups.length === 0 ? (
          <p className="conversation-empty">{snapshot.threads.length === 0 ? "Your first chat will appear here." : "No conversations match your search."}</p>
        ) : (
          groups.map((group) => (
            <section key={group.name} className="conversation-group">
              <h3>{group.name}</h3>
              {group.threads.map((thread) => (
                <div className={`conversation-row${thread.id === snapshot.activeThreadId ? " active" : ""}`} key={thread.id}>
                  {editingId === thread.id ? (
                    <form
                      className="conversation-edit"
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveEdit(thread);
                      }}
                    >
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(event) => setEditValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelEdit();
                          }
                        }}
                        aria-label={`Rename ${thread.title}`}
                      />
                      <button type="submit" className="row-icon-action" aria-label="Save conversation name">
                        <Icon name="check" size={14} />
                      </button>
                      <button type="button" className="row-icon-action" onClick={cancelEdit} aria-label="Cancel rename">
                        <Icon name="close" size={14} />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="conversation-select"
                        onClick={() => {
                          onSwitch(thread.id);
                          onClose();
                        }}
                      >
                        <span className={`thread-activity ${thread.activity}`} aria-hidden="true" />
                        <span className="conversation-row-copy">
                          <b>{thread.title}</b>
                          <small>{thread.attention > 0 ? `${thread.attention} waiting` : relativeTime(thread.updatedAt)}</small>
                        </span>
                      </button>
                      <span className="conversation-row-actions">
                        <button type="button" className="row-icon-action" onClick={() => beginEdit(thread)} disabled={disabled} aria-label={`Rename ${thread.title}`} title={disabled ? "Available when the current response finishes" : "Rename"}>
                          <Icon name="edit" size={14} />
                        </button>
                        <button type="button" className="row-icon-action danger" onClick={() => onDelete(thread)} disabled={disabled} aria-label={`Delete ${thread.title}`} title={disabled ? "Available when the current response finishes" : "Delete"}>
                          <Icon name="trash" size={14} />
                        </button>
                      </span>
                    </>
                  )}
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function DeleteThreadModal({ thread, onCancel, onConfirm }: { thread: ThreadSummary; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const active = document.activeElement;
      if (event.shiftKey && active === cancelRef.current) {
        event.preventDefault();
        confirmRef.current?.focus();
      } else if (!event.shiftKey && active === confirmRef.current) {
        event.preventDefault();
        cancelRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-conversation-title" aria-describedby="delete-conversation-copy">
        <div className="modal-icon">
          <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <h2 id="delete-conversation-title">Delete conversation?</h2>
        <p id="delete-conversation-copy">
          <strong>{thread.title}</strong> will be removed from this device. This cannot be undone.
        </p>
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="btn-outline sm" onClick={onCancel}>
            Cancel
          </button>
          <button ref={confirmRef} type="button" className="btn-danger sm" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function PageHeader({ kicker, title, subtitle }: { kicker: string; title: string; subtitle: string }) {
  return (
    <div className="page-head window-drag-region electrobun-webkit-app-region-drag">
      <p className="caption-uppercase">{kicker}</p>
      <h1 className="display-lg">{title}</h1>
      <p className="page-sub">{subtitle}</p>
    </div>
  );
}

function errorForUi(error: RuntimeError | null): ReactNode {
  if (!error) return null;
  return (
    <div className={`runtime-alert ${error.code === "aborted" ? "muted" : "error"}`} role="status">
      <span>{error.message}</span>
    </div>
  );
}
function ignoreRpc(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

function OrbPresence({ state, docked, animateDock, pulseVersion, orbRef }: { state: OrbState; docked: boolean; animateDock: boolean; pulseVersion: number; orbRef: MutableRefObject<OrbHandle | null> }) {
  const presenceRef = useRef<HTMLDivElement>(null);
  const previousRef = useRef<{
    docked: boolean;
    orbRect: DOMRect;
    presenceRect: DOMRect;
  } | null>(null);
  const previousPulseRef = useRef(pulseVersion);
  const spec = ORB_STATES[state];
  useLayoutEffect(() => {
    const presence = presenceRef.current;
    const orb = presence?.querySelector<HTMLElement>(".orb-float");
    if (!presence || !orb) return;
    const previous = previousRef.current;
    const nextOrbRect = orb.getBoundingClientRect();
    const nextPresenceRect = presence.getBoundingClientRect();
    if (animateDock && docked && previous && !previous.docked) {
      const animation = orb.animate(
        [
          {
            transform: `translate(${previous.orbRect.left - nextOrbRect.left}px, ${previous.orbRect.top - nextOrbRect.top}px) scale(${previous.orbRect.width / Math.max(nextOrbRect.width, 1)})`,
          },
          { transform: "translate(0px, 0px) scale(1)" },
        ],
        { duration: 820, easing: "cubic-bezier(.25, 1.3, .4, 1)" },
      );
      animation.onfinish = () => {
        orb.style.transform = "";
      };
      presence.animate(
        [
          { height: `${previous.presenceRect.height}px`, opacity: 1 },
          { height: `${nextPresenceRect.height}px`, opacity: 1 },
        ],
        { duration: 640, easing: "cubic-bezier(.5, 0, .8, .35)" },
      );
      orbRef.current?.pulse();
    }
    previousRef.current = {
      docked,
      orbRect: nextOrbRect,
      presenceRect: nextPresenceRect,
    };
  }, [animateDock, docked, orbRef]);
  useEffect(() => {
    if (pulseVersion !== previousPulseRef.current) {
      orbRef.current?.pulse();
      previousPulseRef.current = pulseVersion;
    }
  }, [orbRef, pulseVersion]);
  return (
    <div ref={presenceRef} className={`orb-presence ${docked ? "orb-presence-docked" : "orb-presence-hero"}`}>
      <div className="orb-frame">
        <Orb ref={orbRef} state={state} />
      </div>
      <div className="orb-meta">
        <span className="orb-state-label">{spec.label}</span>
        {spec.description && <span className="orb-state-desc">{spec.description}</span>}
      </div>
    </div>
  );
}

function useConversationOrbState(snapshot: RuntimeSnapshot): {
  state: OrbState;
  pulseVersion: number;
} {
  const [state, setState] = useState<OrbState>("idle");
  const [pulseVersion, setPulseVersion] = useState(0);
  const previousRef = useRef<{
    threadId: string | null;
    runId: string | null;
    runStatus: string | null;
    hadError: boolean;
  } | null>(null);
  const transientRef = useRef(false);
  const recoveryTargetRef = useRef<OrbState | null>(null);
  const timersRef = useRef<number[]>([]);
  useEffect(() => {
    const previous = previousRef.current;
    const threadChanged = previous !== null && previous.threadId !== snapshot.activeThreadId;
    const activeRun = snapshot.activeRun?.threadId === snapshot.activeThreadId ? snapshot.activeRun : null;
    const steadyState = deriveOrbSteadyState(snapshot);
    const clearTimers = () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current = [];
      transientRef.current = false;
      recoveryTargetRef.current = null;
    };
    const sequence = (steps: Array<{ state: OrbState; duration: number }>) => {
      clearTimers();
      transientRef.current = true;
      let elapsed = 0;
      setState(steps[0].state);
      steps.slice(1).forEach((step, index) => {
        elapsed += steps[index].duration;
        timersRef.current.push(
          window.setTimeout(() => {
            setState(step.state);
            if (index === steps.length - 2) {
              transientRef.current = false;
              timersRef.current = [];
            }
          }, elapsed),
        );
      });
    };
    const startErrorRecovery = (target: OrbState) => {
      clearTimers();
      transientRef.current = true;
      recoveryTargetRef.current = target;
      setState("recovery");
      timersRef.current = [
        window.setTimeout(() => setState("idle"), 1300),
        window.setTimeout(() => {
          setState(recoveryTargetRef.current ?? "idle");
          recoveryTargetRef.current = null;
          transientRef.current = false;
          timersRef.current = [];
        }, 1500),
      ];
    };
    if (threadChanged) clearTimers();
    const recovered = recoveryGate(previous?.hadError ?? false, threadChanged, steadyState);
    if (steadyState === "error") {
      clearTimers();
      setState("error");
    } else if (recoveryTargetRef.current) {
      recoveryTargetRef.current = steadyState;
    } else if (recovered) {
      startErrorRecovery(recovered[2]);
    } else if (steadyState === "waiting") {
      clearTimers();
      setState("waiting");
    } else if (activeRun?.status === "running") {
      clearTimers();
      setState(steadyState);
    } else if (!threadChanged && previous?.runStatus === "running" && previous.runId) {
      if (snapshot.error?.code === "aborted" || activeRun?.status === "aborted")
        sequence([
          { state: "interrupted", duration: 1400 },
          { state: "recovery", duration: 1300 },
          { state: "idle", duration: 0 },
        ]);
      else if (!snapshot.error) {
        setPulseVersion((value) => value + 1);
        sequence([
          { state: "done", duration: 1400 },
          { state: "idle", duration: 0 },
        ]);
      }
    } else if (!transientRef.current) setState(steadyState);
    previousRef.current = {
      threadId: snapshot.activeThreadId,
      runId: activeRun?.runId ?? null,
      runStatus: activeRun?.status ?? null,
      hadError: steadyState === "error",
    };
  }, [snapshot]);
  useEffect(() => () => timersRef.current.forEach((timer) => window.clearTimeout(timer)), []);
  return { state, pulseVersion };
}

function useSmartScroll(itemKey: string): {
  threadRef: MutableRefObject<HTMLDivElement | null>;
  showLatest: boolean;
  jumpLatest: () => void;
} {
  const threadRef = useRef<HTMLDivElement>(null);
  const [showLatest, setShowLatest] = useState(false);
  const nearBottomRef = useRef(true);
  useEffect(() => {
    const element = threadRef.current;
    if (!element) return;
    const update = () => {
      nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
      setShowLatest(!nearBottomRef.current);
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    return () => element.removeEventListener("scroll", update);
  }, []);
  useLayoutEffect(() => {
    const element = threadRef.current;
    if (!element || !nearBottomRef.current) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [itemKey]);
  return {
    threadRef,
    showLatest,
    jumpLatest: () => {
      threadRef.current?.scrollTo({
        top: threadRef.current.scrollHeight,
        behavior: "smooth",
      });
      setShowLatest(false);
      nearBottomRef.current = true;
    },
  };
}

function MessageActions({ message, onRetry, onContinue }: { message: ChatMessage; onRetry?: () => void; onContinue?: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const pending = navigator.clipboard?.writeText(message.text);
    if (pending)
      void pending.then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      });
  };
  return (
    <div className="message-actions">
      <button type="button" className="message-action" onClick={copy} aria-label="Copy message">
        <Icon name="copy" size={13} />
        {copied ? "Copied" : "Copy"}
      </button>
      {message.status === "error" && message.retryable && onRetry && (
        <button type="button" className="message-action" onClick={onRetry}>
          <Icon name="retry" size={13} /> Retry
        </button>
      )}
      {message.status === "interrupted" && onContinue && (
        <button type="button" className="message-action" onClick={onContinue}>
          <Icon name="play" size={13} /> Continue
        </button>
      )}
    </div>
  );
}

const markdownComponents = {
  code({ children, className, ...props }: ComponentPropsWithoutRef<"code">) {
    const value = String(children).replace(/\n$/, "");
    return className ? (
      <div className="code-wrap">
        <button
          type="button"
          className="code-copy"
          onClick={() => {
            const pending = navigator.clipboard?.writeText(value);
            if (pending) void pending;
          }}
          aria-label="Copy code"
        >
          <Icon name="copy" size={12} />
        </button>
        <code className={className} {...props}>
          {children}
        </code>
      </div>
    ) : (
      <code {...props}>{children}</code>
    );
  },
};

function AssistantTurn({ messages, textParts, tools, pendingIds, onRetry, onContinue }: { messages: ChatMessage[]; textParts: Extract<ChatMessage["parts"][number], { type: "text" }>[]; tools: ChatToolPart[]; pendingIds: Set<string>; onRetry: (id: string) => void; onContinue: (id: string) => void }) {
  const terminal = messages.at(-1)!;
  const actionMessage = {
    ...terminal,
    text: textParts.map((part) => part.text).join("\n\n"),
  };
  return (
    <div className={`msg ai message-${terminal.status}`}>
      <div className="msg-body">
        {textParts.map((part) => (
          <div className="msg-text markdown-body" key={part.id}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {part.text}
            </ReactMarkdown>
          </div>
        ))}
        <ToolTimeline tools={tools} live={terminal.status === "streaming"} pendingIds={pendingIds} />
        {(terminal.status === "interrupted" || terminal.status === "error") && <span className="message-status">{terminal.status === "interrupted" ? "Stopped" : "Response failed"}</span>}
        <MessageActions message={actionMessage} onRetry={terminal.status === "error" ? () => onRetry(terminal.id) : undefined} onContinue={terminal.status === "interrupted" ? () => onContinue(terminal.id) : undefined} />
      </div>
    </div>
  );
}

function InteractionCard({ interaction, onRespond, onResubmit, onDismiss }: { interaction: PendingInteraction; onRespond: (toolCallId: string, response: unknown) => Promise<InteractionResponseResult>; onResubmit: (messageId: string) => Promise<boolean>; onDismiss: (toolCallId: string) => Promise<InteractionResponseResult> }) {
  const [answer, setAnswer] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [submittingAction, setSubmittingAction] = useState<InteractionSubmissionAction>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const isPlan = interaction.kind === "submit_plan";
  const failed = interaction.status === "failed";
  const submissionUi = interactionSubmissionUi(interaction.status, submittingAction);
  const resolving = submissionUi.resolving;
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
  const submit = () => void send(isPlan ? { action: "approved", feedback: feedback.trim() || undefined } : interaction.options.length > 0 && interaction.selectionMode === "multi_select" ? selected : interaction.options.length > 0 ? (selected[0] ?? "") : answer.trim(), isPlan ? "approve" : "answer");
  const toggle = (label: string) => setSelected((current) => (current.includes(label) ? current.filter((value) => value !== label) : [...current, label]));
  return (
    <article className={`interaction-card interaction-${interaction.kind}${resolving ? " resolving" : ""}${failed ? " failed" : ""}`} id={`interaction-${interaction.id}`}>
      <div className="interaction-kicker">{submissionUi.kicker ?? (failed ? "Response failed" : isPlan ? "Plan approval" : "Your input needed")}</div>
      <h3>{interaction.title}</h3>
      {interaction.question && <p>{interaction.question}</p>}
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
      {!failed && !isPlan && interaction.options.length > 0 && (
        <div className={`interaction-options ${interaction.selectionMode === "multi_select" ? "multi" : ""}`}>
          {interaction.options.map((option) => (
            <label key={option.label} className={`interaction-option${selected.includes(option.label) ? " selected" : ""}`}>
              <input disabled={resolving} type={interaction.selectionMode === "multi_select" ? "checkbox" : "radio"} name={interaction.id} checked={selected.includes(option.label)} onChange={() => (interaction.selectionMode === "multi_select" ? toggle(option.label) : setSelected([option.label]))} />
              <span>
                <b>{option.label}</b>
                {option.description && <small>{option.description}</small>}
              </span>
            </label>
          ))}
        </div>
      )}
      {!failed && !isPlan && interaction.options.length === 0 && <textarea disabled={resolving} className="interaction-input" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Type your answer…" rows={2} />}
      {!failed && isPlan && <textarea disabled={resolving} className="interaction-input" value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Optional feedback or requested changes" rows={2} />}
      {(localError || interaction.error) && <p className="interaction-error" role="alert">{localError ?? interaction.error?.message}</p>}
      <div className="interaction-actions">
        {failed ? (
          <>
            <button type="button" className="btn-outline sm" disabled={resolving} onClick={() => void onDismiss(interaction.toolCallId)}>Dismiss</button>
            {interaction.originMessageId && <button type="button" className="btn-primary sm" disabled={resolving} onClick={() => void onResubmit(interaction.originMessageId as string)}>Resubmit turn</button>}
          </>
        ) : isPlan && (
          <button
            disabled={resolving}
            type="button"
            className="btn-outline sm"
            onClick={() =>
              void send({
                action: "rejected",
                feedback: feedback.trim() || "Please revise the plan.",
              }, "reject")
            }
          >
            {submissionUi.rejectLabel}
          </button>
        )}
        {!failed && <button type="button" className="btn-primary sm" onClick={submit} disabled={resolving || (!isPlan && interaction.options.length > 0 && selected.length === 0) || (!isPlan && interaction.options.length === 0 && !answer.trim())}>
          {isPlan ? submissionUi.approveLabel : "Send answer"}
        </button>}
      </div>
    </article>
  );
}

function QueuedMessageBubble({ draft, onSteer }: { draft: QueuedDraft; onSteer: (draft: QueuedDraft) => void }) {
  return (
    <div className="msg user queued-message" data-queued-state={draft.state}>
      <div className="bubble"><span>{draft.text}</span></div>
      <div className="queued-message-meta">
        <span className="queued-badge">{draft.state === "sending" ? "Sending" : "Queued"}</span>
        {draft.state === "queued" && <button type="button" className="queued-steer" onClick={() => onSteer(draft)}>Steer now</button>}
      </div>
    </div>
  );
}

function Companion({ snapshot, activeTitle, input, setInput, queuedDrafts, onSend, onSteerQueued, onAbort, onSettings, onCreate, onSwitch, onRename, onDeleteRequest, onOrbState, onRetry, onContinue, onInteraction, onInteractionDismiss, onToolApproval }: { snapshot: RuntimeSnapshot; activeTitle: string; input: string; setInput: (value: string) => void; queuedDrafts: QueuedDraft[]; onSend: (event: FormEvent<HTMLFormElement>) => void; onSteerQueued: (draft: QueuedDraft) => void; onAbort: () => void; onSettings: () => void; onCreate: () => void; onSwitch: (threadId: string) => void; onRename: (threadId: string, title: string) => void; onDeleteRequest: (thread: ThreadSummary) => void; onOrbState: (state: OrbState) => void; onRetry: (messageId: string) => void; onContinue: (messageId: string) => void; onInteraction: (toolCallId: string, response: unknown) => Promise<InteractionResponseResult>; onInteractionDismiss: (toolCallId: string) => Promise<InteractionResponseResult>; onToolApproval: (toolCallId: string, approved: boolean) => Promise<boolean> }) {
  const runningForSelected = snapshot.activeRun?.status === "running" && snapshot.activeRun.threadId === snapshot.activeThreadId;
  const runningElsewhere = snapshot.activeRun?.status === "running" && !runningForSelected;
  const selectedModel = snapshot.models.find((model) => model.id === snapshot.selectedModelId);
  const effectiveProviderId = selectedModel?.providerId ?? snapshot.selectedProviderId;
  const selectedProvider = snapshot.providers.find((provider) => provider.id === effectiveProviderId);
  const canChat = selectedProviderCanChat(snapshot) && snapshot.activeThreadId !== null && !runningElsewhere;
  const { state, pulseVersion } = useConversationOrbState(snapshot);
  const orbRef = useRef<OrbHandle>(null);
  const titleRef = useRef<HTMLButtonElement>(null);
  const workbenchToggleRef = useRef<HTMLButtonElement>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [renameRequest, setRenameRequest] = useState<string | null>(null);
  const [workbenchOpenByThread, setWorkbenchOpenByThread] = useState<Map<string, boolean>>(() => new Map());
  const [dockedThreads, setDockedThreads] = useState<Set<string>>(() => new Set());
  const lastMessage = snapshot.messages[snapshot.messages.length - 1];
  const { threadRef, showLatest, jumpLatest } = useSmartScroll(`${snapshot.activeThreadId ?? "none"}:${lastMessage?.id ?? "none"}:${lastMessage?.text.length ?? 0}:${snapshot.interactions.length}`);
  const workbenchHasContent = shouldShowWorkbench(snapshot.workbench);
  const workbenchOpen = !!snapshot.activeThreadId && workbenchHasContent && workbenchOpenByThread.get(snapshot.activeThreadId) === true;
  const workbenchAttention = snapshot.workbench.pendingInteractions.filter((item) => item.status === "pending" || item.status === "resolving").length + (snapshot.toolApproval ? 1 : 0);
  const draftPresent = input.trim().length > 0;
  const primaryComposerAction = composerAction(runningForSelected, draftPresent);
  const inputLineCount = composerLineCount(input);
  const titleTriggerClose = () => {
    setSessionsOpen(false);
    setRenameRequest(null);
  };
  useEffect(() => {
    onOrbState(state);
  }, [onOrbState, state]);
  useEffect(() => {
    if (!snapshot.activeThreadId || (!snapshot.messages.length && !snapshot.activeRun)) return;
    setDockedThreads((current) => (current.has(snapshot.activeThreadId as string) ? current : new Set(current).add(snapshot.activeThreadId as string)));
  }, [snapshot.activeRun, snapshot.messages.length, snapshot.activeThreadId]);
  useEffect(() => {
    if (!sessionsOpen) titleRef.current?.focus();
  }, [sessionsOpen]);
  useEffect(() => {
    if (!workbenchOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (snapshot.activeThreadId) setWorkbenchOpenByThread((current) => new Map(current).set(snapshot.activeThreadId as string, false));
      requestAnimationFrame(() => workbenchToggleRef.current?.focus());
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [snapshot.activeThreadId, workbenchOpen]);
  const docked = !!snapshot.activeThreadId && (snapshot.messages.length > 0 || !!snapshot.activeRun || dockedThreads.has(snapshot.activeThreadId));
  const animateDock = !!snapshot.activeThreadId && runningForSelected && !dockedThreads.has(snapshot.activeThreadId);
  const lastErrorMessage = [...snapshot.messages].reverse().find((message) => message.status === "error");
  const retryTarget = snapshot.retryMessageId ?? lastErrorMessage?.id;
  const conversationItems = useMemo(() => groupConversationItems(snapshot.messages), [snapshot.messages]);
  const pendingToolIds = useMemo(() => new Set([...snapshot.interactions.map((item) => item.toolCallId), ...(snapshot.toolApproval ? [snapshot.toolApproval.toolCallId] : [])]), [snapshot.interactions, snapshot.toolApproval]);
  const jumpToInteraction = (id: string) => {
    document.getElementById(`interaction-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  return (
    <section className="view active companion-view">
      <div className="chat-titlebar window-drag-region electrobun-webkit-app-region-drag">
        <div className="chat-title-copy">
          <button
            ref={titleRef}
            className="chat-title-trigger electrobun-webkit-app-region-no-drag"
            type="button"
            onClick={() => {
              setRenameRequest(null);
              setSessionsOpen((value) => !value);
            }}
            onDoubleClick={() => {
              if (!snapshot.activeThreadId || snapshot.activeRun) return;
              setRenameRequest(snapshot.activeThreadId);
              setSessionsOpen(true);
            }}
            aria-expanded={sessionsOpen}
            aria-haspopup="dialog"
          >
            <h1 className="chat-title">{activeTitle}</h1>
            <Icon name="down" size={18} />
          </button>
        </div>
        {workbenchHasContent && (
          <button
            ref={workbenchToggleRef}
            type="button"
            className={`workbench-toggle electrobun-webkit-app-region-no-drag${workbenchOpen ? " active" : ""}`}
            aria-label={workbenchOpen ? "Close Workbench" : "Open Workbench"}
            aria-expanded={workbenchOpen}
            aria-controls="conversation-workbench"
            onClick={() => {
              if (!snapshot.activeThreadId) return;
              setWorkbenchOpenByThread((current) => new Map(current).set(snapshot.activeThreadId as string, !workbenchOpen));
            }}
          >
            <Icon name="panel" size={16} />
            <span>Workbench</span>
            {workbenchAttention > 0 && <b>{workbenchAttention}</b>}
          </button>
        )}
        <ConversationPopover snapshot={snapshot} open={sessionsOpen} disabled={snapshot.activeRun !== null} initialEditingId={renameRequest} onClose={titleTriggerClose} onCreate={onCreate} onSwitch={onSwitch} onRename={onRename} onDelete={onDeleteRequest} />
      </div>
      <div className="text-chat-layout">
        <div className={`companion-grid ${workbenchOpen ? "workbench-present" : "workbench-absent"}`}>
          <div className="stage">
            {runningElsewhere && <div className="other-run-note">Another conversation is running. You can browse this chat while it finishes.</div>}
            <OrbPresence state={state} docked={docked} animateDock={animateDock} pulseVersion={pulseVersion} orbRef={orbRef} />
            <div className="thread" ref={threadRef} aria-live="polite">
              {conversationItems.map((item) =>
                item.type === "user" ? (
                  <div className="msg user" key={item.message.id}>
                    <div className="bubble">
                      <span>{item.message.text}</span>
                    </div>
                    <MessageActions message={item.message} />
                  </div>
                ) : (
                  <AssistantTurn key={item.id} messages={item.messages} textParts={item.textParts} tools={item.tools} pendingIds={pendingToolIds} onRetry={onRetry} onContinue={onContinue} />
                ),
              )}
              {queuedDrafts.map((draft) => <QueuedMessageBubble key={draft.id} draft={draft} onSteer={onSteerQueued} />)}
              {snapshot.events.map((event: ChatEvent) => (
                <div className="chat-event" key={event.id}>
                  {event.text}
                </div>
              ))}
              {snapshot.interactions.map((interaction) => (
                <InteractionCard key={interaction.id} interaction={interaction} onRespond={onInteraction} onDismiss={onInteractionDismiss} onResubmit={(messageId) => rpc.request["chat.retry"]({ messageId }).then((result) => result.accepted).catch(() => false)} />
              ))}
              {snapshot.toolApproval && <ToolApprovalCard approval={snapshot.toolApproval} onRespond={onToolApproval} />}
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
              {snapshot.error?.code === "aborted" && <div className="run-stopped-note">Response stopped. You can continue from the partial answer above.</div>}
              {showLatest && (
                <button type="button" className="latest-btn" onClick={jumpLatest}>
                  <Icon name="latest" size={14} /> Latest
                </button>
              )}
            </div>
            <form className={`composer${canChat ? "" : " disabled"}`} onSubmit={onSend} autoComplete="off">
              <textarea
                className="composer-input"
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  orbRef.current?.nudge();
                }}
                placeholder={runningElsewhere ? "Another conversation is running…" : canChat ? "Message PROTEUS…" : `Configure ${selectedProvider?.name ?? "a provider"} in Settings to chat`}
                aria-label="Message PROTEUS"
                disabled={!canChat}
                maxLength={32_000}
                rows={inputLineCount}
                onKeyDown={(event) => {
                  if (!shouldSubmitComposerKey({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing })) return;
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
              />
              <div className="composer-footer">
                <div className="composer-context">
                  <span>{selectedModel?.name ?? snapshot.selectedModelId}</span>
                  {selectedProvider?.verified !== true && <button className="btn-tertiary" type="button" onClick={onSettings}>Configure provider</button>}
                </div>
                <span className="composer-hint">Enter to send · Shift+Enter for new line</span>
                {primaryComposerAction === "stop" ? (
                  <button className="composer-primary composer-primary-stop" type="button" aria-label="Stop response" onClick={onAbort}><Icon name="stop" size={17} /></button>
                ) : (
                  <button className="composer-primary" type="submit" aria-label={primaryComposerAction === "queue" ? "Queue message" : "Send"} disabled={!canChat || !draftPresent}><Icon name="send" size={18} /></button>
                )}
              </div>
            </form>
          </div>
          {workbenchOpen && (
            <button
              type="button"
              className="workbench-backdrop"
              aria-label="Close Workbench"
              onClick={() => {
                if (!snapshot.activeThreadId) return;
                setWorkbenchOpenByThread((current) => new Map(current).set(snapshot.activeThreadId as string, false));
                requestAnimationFrame(() => workbenchToggleRef.current?.focus());
              }}
            />
          )}
          {workbenchOpen && <Workbench snapshot={snapshot} onJump={jumpToInteraction} onClose={() => {
            if (!snapshot.activeThreadId) return;
            setWorkbenchOpenByThread((current) => new Map(current).set(snapshot.activeThreadId as string, false));
            requestAnimationFrame(() => workbenchToggleRef.current?.focus());
          }} />}
        </div>
      </div>
    </section>
  );
}

export function SettingsView({ snapshot, apiKey, setApiKey, onConnect, onDisconnect, onRefresh, onSelectProvider, onSelectModel, onSelectReasoning }: { snapshot: RuntimeSnapshot; apiKey: string; setApiKey: (value: string) => void; onConnect: (event: FormEvent<HTMLFormElement>) => void; onDisconnect: () => void; onRefresh: () => void; onSelectProvider: (providerId: "openrouter" | "codex") => void; onSelectModel: (modelId: ProviderModel["id"]) => void; onSelectReasoning: (effort: RuntimeSnapshot["selectedReasoningEffort"]) => void }) {
  const [tab, setTab] = useState<"providers" | "models">("providers");
  const [modelSearch, setModelSearch] = useState("");
  const selected = snapshot.models.find((model) => model.id === snapshot.selectedModelId);
  const price = (value: number | undefined) => (value === undefined ? "—" : `$${(value * 1_000_000).toFixed(2)}/M`);
  const providerModels = snapshot.models.filter((model) => model.providerId === snapshot.selectedProviderId);
  const displayedModels = providerModels.filter((model, index, all) => {
    if (model.providerId === "codex" && all.findIndex((candidate) => candidate.baseModelId === model.baseModelId) !== index) return false;
    const query = modelSearch.trim().toLowerCase();
    return !query || `${model.name} ${model.baseModelId ?? model.rawId}`.toLowerCase().includes(query);
  });
  const chooseDisplayedModel = (model: ProviderModel) => {
    if (model.providerId !== "codex") return onSelectModel(model.id);
    const preferred = snapshot.models.find((candidate) => candidate.providerId === "codex" && candidate.baseModelId === model.baseModelId && candidate.reasoningEffort === snapshot.selectedReasoningEffort);
    onSelectModel((preferred ?? model).id);
  };
  return (
    <section className="view active"><div className="page-narrow settings-page">
      <PageHeader kicker="Yours to control" title="Settings" subtitle="Choose how PROTEUS connects, which model thinks, and how deeply it reasons." />
      <nav className="settings-tabs" aria-label="Settings sections">
        <button type="button" className={tab === "providers" ? "active" : ""} onClick={() => setTab("providers")}>Providers</button>
        <button type="button" className={tab === "models" ? "active" : ""} onClick={() => setTab("models")}>Models & thinking</button>
      </nav>
      {tab === "providers" ? <div className="provider-grid">
        {snapshot.providers.map((provider) => <section className={`card provider-card ${snapshot.selectedProviderId === provider.id ? "selected" : ""}`} key={provider.id}>
          <div className="provider-card-head"><div><span className="settings-eyebrow">{provider.id === "codex" ? "Native ACP" : "Universal gateway"}</span><h2 className="title-md">{provider.name}</h2></div><span className={`provider-badge ${provider.availability}`}>{provider.availability.replace("-", " ")}</span></div>
          <p className="settings-intro">{provider.id === "codex" ? "Uses your local Codex sign-in through Mastra ACP. No API key is copied into PROTEUS." : "Use one OpenRouter key to access your account's text-model catalog."}</p>
          {provider.id === "openrouter" ? <>
            <form className="key-form" onSubmit={onConnect}><Icon name="key" size={18} /><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={snapshot.credential.configured ? "Enter a replacement key" : "sk-or-v1-…"} autoComplete="off" aria-label="OpenRouter API key" /><button className="btn-primary sm" type="submit" disabled={!apiKey.trim() || snapshot.status === "validating-key"}>{snapshot.status === "validating-key" ? "Checking…" : snapshot.credential.configured ? "Replace" : "Connect"}</button></form>
            {snapshot.credential.configured && <button className="btn-danger-ghost" type="button" onClick={onDisconnect}>Disconnect key</button>}
          </> : <p className="provider-detail">{provider.detail ?? "Checking the local Codex connection…"}</p>}
          <button className={snapshot.selectedProviderId === provider.id ? "btn-primary sm" : "btn-outline sm"} type="button" disabled={!provider.verified || snapshot.activeRun !== null || snapshot.selectedProviderId === provider.id} onClick={() => onSelectProvider(provider.id)}>{snapshot.selectedProviderId === provider.id ? "Current provider" : `Use ${provider.name}`}</button>
        </section>)}
        <div className="settings-wide-actions"><button className="btn-outline sm" type="button" onClick={onRefresh} disabled={snapshot.status === "loading-models"}><Icon name="refresh" size={15} /> Refresh connections</button></div>{errorForUi(snapshot.error)}
      </div> : <section className="card settings-card model-settings-card">
        <div className="settings-section-head"><div><h2 className="title-md">Model</h2><p className="settings-intro">Selection is saved for this conversation.</p></div><button className="btn-outline sm" type="button" onClick={onRefresh}><Icon name="refresh" size={15} /> Refresh</button></div>
        <div className="provider-switch" role="group" aria-label="Model provider">{snapshot.providers.map((provider) => <button type="button" key={provider.id} className={snapshot.selectedProviderId === provider.id ? "active" : ""} disabled={!provider.verified} onClick={() => onSelectProvider(provider.id)}>{provider.name}</button>)}</div>
        <div className="model-search"><Search size={16} /><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search models" aria-label="Search models" /></div>
        <div className="model-card-list">{displayedModels.map((model) => { const isSelected = selected?.providerId === model.providerId && (model.providerId === "openrouter" ? selected.id === model.id : selected.baseModelId === model.baseModelId); return <button type="button" className={`model-card ${isSelected ? "selected" : ""}`} key={model.id} onClick={() => chooseDisplayedModel(model)} disabled={snapshot.activeRun !== null}><span className="model-card-copy"><strong>{model.providerId === "codex" ? model.baseModelId : model.name}</strong><small>{model.description ?? model.rawId}</small></span>{isSelected && <Check size={17} />}</button>; })}</div>
        {selected?.reasoningOptions?.length ? <div className="reasoning-control"><div><span className="settings-eyebrow">Thinking</span><strong>Reasoning effort</strong></div><div className="reasoning-options">{selected.reasoningOptions.map((effort) => <button type="button" key={effort} className={snapshot.selectedReasoningEffort === effort ? "active" : ""} onClick={() => onSelectReasoning(effort)} disabled={snapshot.activeRun !== null}>{effort}</button>)}</div></div> : <p className="settings-note">This model does not advertise adjustable reasoning.</p>}
        {selected && <div className="model-meta"><span>{selected.contextLength ? `${selected.contextLength.toLocaleString()} token context` : selected.providerId === "codex" ? "Context managed by Codex" : "Provider-managed context"}</span>{selected.providerId === "openrouter" && <><span>Prompt {price(selected.promptPrice)}</span><span>Completion {price(selected.completionPrice)}</span></>}</div>}
      </section>}
    </div></section>
  );
}

function Projects() {
  return (
    <section className="view active">
      <div className="page-narrow">
        <PageHeader kicker="Your contexts" title="Projects" subtitle="Keep longer-running work organized around the conversations that matter." />
        <div className="card">
          <p>Projects will be available here when you are ready to organize longer-running work.</p>
        </div>
      </div>
    </section>
  );
}
function Memory() {
  return (
    <section className="view active">
      <div className="page-narrow">
        <PageHeader kicker="Conversation history" title="Memory" subtitle="Conversation history stays on this device. You decide what should be kept for later." />
        <div className="card">
          <p>Long-term memory is not enabled yet. Your conversation history remains available in its chat.</p>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const [view, setView] = useState<View>("companion");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [input, setInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [, setOrbState] = useState<OrbState>("idle");
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(DEFAULT_SNAPSHOT);
  const [localMessages, setLocalMessages] = useState<Map<string, ChatMessage>>(() => new Map());
  const [queuedDrafts, setQueuedDrafts] = useState<QueuedDraft[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<ThreadSummary | null>(null);
  const latestRevisionRef = useRef(0);
  useEffect(() => {
    const applyEnvelope = (envelope: RuntimeSnapshotEnvelope) => {
      try {
        const next = decodeRuntimeSnapshot(envelope);
        if (next.revision <= latestRevisionRef.current) return;
        latestRevisionRef.current = next.revision;
        setSnapshot(next);
      } catch {
        setSnapshot((current) => ({
          ...current,
          status: "error",
          error: {
            code: "unknown",
            message: "A runtime update could not be decoded. Restart PROTEUS and try again.",
            retryable: true,
          },
        }));
      }
    };
    const onChanged = (next: RuntimeSnapshotEnvelope) => applyEnvelope(next);
    rpc.addMessageListener("runtime.changed", onChanged);
    void rpc.request["runtime.bootstrap"]()
      .then(applyEnvelope)
      .catch(() =>
        setSnapshot((current) => ({
          ...current,
          status: "offline",
          error: {
            code: "offline",
            message: "The desktop runtime is not reachable.",
            retryable: true,
          },
        })),
      );
    return () => rpc.removeMessageListener("runtime.changed", onChanged);
  }, []);
  useEffect(() => {
    if (localMessages.size === 0) return;
    setLocalMessages((current) => {
      const next = new Map(current);
      for (const id of next.keys()) if (snapshot.messages.some((message) => message.id === id) || snapshot.activeThreadId === null) next.delete(id);
      return next.size === current.size ? current : next;
    });
  }, [localMessages.size, snapshot.activeThreadId, snapshot.messages]);
  useEffect(() => {
    setQueuedDrafts((current) => reconcileQueuedDrafts(current, snapshot.messages, snapshot.activeThreadId, snapshot.workbench.queuedFollowUpCount));
  }, [snapshot.activeThreadId, snapshot.messages, snapshot.workbench.queuedFollowUpCount]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && snapshot.activeRun) ignoreRpc(rpc.request["chat.abort"]());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [snapshot.activeRun]);
  const activeTitle = useMemo(() => snapshot.threads.find((thread) => thread.id === snapshot.activeThreadId)?.title ?? "New chat", [snapshot.threads, snapshot.activeThreadId]);
  const handleNavigate = (next: View) => {
    setView(next);
    setSidebarOpen(false);
  };
  const handleSend = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || !snapshot.activeThreadId) return;
    const clientMessageId = crypto.randomUUID();
    const threadId = snapshot.activeThreadId;
    const runningForThread = snapshot.activeRun?.status === "running" && snapshot.activeRun.threadId === threadId;
    const createdAt = new Date().toISOString();
    if (runningForThread) {
      setQueuedDrafts((current) => [...current, { id: clientMessageId, threadId, text, createdAt, state: "queued" }]);
    } else {
      setLocalMessages((current) =>
        new Map(current).set(clientMessageId, {
          id: clientMessageId,
          role: "user",
          text,
          turnId: clientMessageId,
          parts: [{ type: "text", id: `${clientMessageId}:text:0`, text }],
          status: "complete",
          createdAt,
        }),
      );
    }
    setInput("");
    void rpc.request["chat.send"]({ text, clientMessageId })
      .then((result) => {
        if (result.accepted) return;
        if (runningForThread) setQueuedDrafts((current) => current.filter((draft) => draft.id !== clientMessageId));
        setLocalMessages((current) => {
          const next = new Map(current);
          next.delete(clientMessageId);
          return next;
        });
        setInput(text);
      })
      .catch(() => {
        if (runningForThread) setQueuedDrafts((current) => current.filter((draft) => draft.id !== clientMessageId));
        setLocalMessages((current) => {
          const next = new Map(current);
          next.delete(clientMessageId);
          return next;
        });
        setInput(text);
      });
  };
  const handleSteerQueued = (draft: QueuedDraft) => {
    void rpc.request["chat.steer"]({ text: draft.text }).then((result) => {
      if (!result.accepted) return;
      setQueuedDrafts((current) => current.filter((item) => item.threadId !== draft.threadId));
    }).catch(() => undefined);
  };
  const handleConnect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = apiKey;
    setApiKey("");
    ignoreRpc(rpc.request["credentials.connect"]({ apiKey: candidate }));
  };
  const handleCreate = () => {
    if (snapshot.activeRun) return;
    setSidebarOpen(false);
    ignoreRpc(rpc.request["threads.create"]({ title: "New chat" }));
  };
  const handleRename = (threadId: string, title: string) => {
    ignoreRpc(rpc.request["threads.rename"]({ threadId, title }));
  };
  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    ignoreRpc(rpc.request["threads.delete"]({ threadId: target.id }));
  };
  const renderedSnapshot = useMemo<RuntimeSnapshot>(() => {
    if (localMessages.size === 0) return snapshot;
    const messages = [...snapshot.messages];
    for (const message of localMessages.values()) if (!messages.some((item) => item.id === message.id)) messages.push(message);
    messages.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return { ...snapshot, messages };
  }, [localMessages, snapshot]);
  return (
    <>
      <div className="ambient" aria-hidden="true">
        <div className="ambient-orb amb-mint" />
        <div className="ambient-orb amb-lavender" />
        <div className="ambient-orb amb-sky" />
      </div>
      <div className="app-shell">
        <Sidebar view={view} open={sidebarOpen} disabled={snapshot.activeRun !== null} onView={handleNavigate} onToggle={() => setSidebarOpen((value) => !value)} onCreate={handleCreate} />
        {sidebarOpen && <button type="button" className="app-nav-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />}
        <main>
          {view === "companion" && (
            <Companion
              snapshot={renderedSnapshot}
              activeTitle={activeTitle}
              input={input}
              setInput={setInput}
              queuedDrafts={queuedDrafts.filter((draft) => draft.threadId === renderedSnapshot.activeThreadId)}
              onSend={handleSend}
              onSteerQueued={handleSteerQueued}
              onAbort={() => ignoreRpc(rpc.request["chat.abort"]())}
              onSettings={() => handleNavigate("settings")}
              onCreate={handleCreate}
              onSwitch={(threadId) => ignoreRpc(rpc.request["threads.select"]({ threadId }))}
              onRename={handleRename}
              onDeleteRequest={setDeleteTarget}
              onOrbState={setOrbState}
              onRetry={(messageId) => ignoreRpc(rpc.request["chat.retry"]({ messageId }))}
              onContinue={(messageId) => ignoreRpc(rpc.request["chat.continue"]({ messageId }))}
              onInteraction={(toolCallId, response) => rpc.request["chat.interaction.respond"]({ toolCallId, response })}
              onInteractionDismiss={(toolCallId) => rpc.request["chat.interaction.dismiss"]({ toolCallId })}
              onToolApproval={(toolCallId, approved) =>
                rpc.request["chat.tool-approval.respond"]({
                  toolCallId,
                  approved,
                })
                  .then((result) => result.accepted)
                  .catch(() => false)
              }
            />
          )}
          {view === "projects" && <Projects />}
          {view === "memory" && <Memory />}
          {view === "settings" && <SettingsView snapshot={snapshot} apiKey={apiKey} setApiKey={setApiKey} onConnect={handleConnect} onDisconnect={() => ignoreRpc(rpc.request["credentials.disconnect"]())} onRefresh={() => ignoreRpc(rpc.request["models.refresh"]())} onSelectProvider={(providerId) => ignoreRpc(rpc.request["providers.select"]({ providerId }))} onSelectModel={(modelId) => ignoreRpc(rpc.request["models.select"]({ modelId }))} onSelectReasoning={(reasoningEffort) => ignoreRpc(rpc.request["models.reasoning.select"]({ reasoningEffort }))} />}
        </main>
      </div>
      {deleteTarget && <DeleteThreadModal thread={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={handleDeleteConfirm} />}
    </>
  );
}

function ToolApprovalCard({ approval, onRespond }: { approval: ToolApproval; onRespond: (toolCallId: string, approved: boolean) => Promise<boolean> }) {
  const [decision, setDecision] = useState<"approve" | "decline" | null>(null);
  const resolving = decision !== null;
  const args = useMemo(() => {
    try {
      return JSON.stringify(approval.args, null, 2);
    } catch {
      return "Unable to display tool arguments.";
    }
  }, [approval.args]);
  const respond = (approved: boolean) => {
    if (resolving) return;
    setDecision(approved ? "approve" : "decline");
    void onRespond(approval.toolCallId, approved)
      .then((accepted) => {
        if (!accepted) setDecision(null);
      })
      .catch(() => setDecision(null));
  };
  return (
    <article className={`interaction-card tool-approval-card${resolving ? " resolving" : ""}`} id={`tool-approval-${approval.toolCallId}`}>
      <div className="interaction-kicker">{decision === "approve" ? "Approving tool…" : decision === "decline" ? "Declining tool…" : "Approval required"}</div>
      <h3>Allow {approval.toolName}?</h3>
      <p>PROTEUS is ready to use this tool. Review the request before it continues.</p>
      <pre className="tool-approval-args">{args}</pre>
      <div className="interaction-actions">
        <button disabled={resolving} type="button" className="btn-outline sm" onClick={() => respond(false)}>
          {decision === "decline" ? "Declining…" : "Decline"}
        </button>
        <button disabled={resolving} type="button" className="btn-primary sm" onClick={() => respond(true)}>
          {decision === "approve" ? "Approving…" : "Approve"}
        </button>
      </div>
    </article>
  );
}
