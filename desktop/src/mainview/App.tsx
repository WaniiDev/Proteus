import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowRight,
  Box,
  Check,
  ChevronDown,
  ChevronLeft,
  Circle,
  Copy,
  Folder,
  KeyRound,
  MessageSquarePlus,
  PanelRight,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  Square,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ChatEvent,
  ChatMessage,
  OpenRouterModel,
  OrbState,
  PendingInteraction,
  QueuedFollowUp,
  RuntimeError,
  RuntimeSnapshot,
  RuntimeSnapshotEnvelope,
  ThreadSummary,
  WorkbenchTask,
} from "../shared/contracts";
import { ORB_STATES } from "./orb-spec";
import { mountOrb, type OrbFX } from "./orb3d";
import { rpc } from "./bridge";
import { decodeRuntimeSnapshot } from "../shared/runtime-snapshot-codec";
import { goalFromMessages, groupThreads, relativeTime, shouldShowWorkbench } from "./ui-helpers";

type View = "companion" | "projects" | "memory" | "settings";

const DEFAULT_SNAPSHOT: RuntimeSnapshot = {
  status: "booting",
  credential: { configured: false, verified: false },
  models: [{ id: "openrouter/auto", rawId: "auto", name: "Auto Router", inputModalities: ["text"], outputModalities: ["text"] }],
  selectedModelId: "openrouter/auto",
  threads: [],
  activeThreadId: null,
  messages: [],
  events: [],
  interactions: [],
  resolvedInteractions: [],
  workbench: { status: "idle", tasks: [], pendingInteractions: [], queuedFollowUps: [], clearedFollowUps: [], tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, activeTools: [] },
  activeRun: null,
  error: null,
};

type IconName = "companion" | "projects" | "memory" | "settings" | "send" | "stop" | "chevron" | "down" | "plus" | "trash" | "refresh" | "key" | "edit" | "copy" | "retry" | "play" | "close" | "latest" | "steer" | "panel" | "search" | "check" | "new-chat" | "arrow-right";

const ICONS: Record<IconName, LucideIcon> = {
  companion: Circle,
  projects: Folder,
  memory: Box,
  settings: Settings,
  send: Send,
  stop: Square,
  chevron: ChevronLeft,
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
  panel: PanelRight,
  search: Search,
  check: Check,
  "new-chat": MessageSquarePlus,
  "arrow-right": ArrowRight,
};

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
    return () => { controller.dispose(); controllerRef.current = null; };
  }, []);
  useImperativeHandle(ref, () => ({ pulse: () => controllerRef.current?.pulse(), nudge: () => controllerRef.current?.nudge() }), []);
  useEffect(() => { controllerRef.current?.setState(state); }, [state]);
  return <div className="orb-float" ref={floatRef} data-state={state}><div className="orb-shadow" aria-hidden="true" /><canvas className="orb-canvas" ref={canvasRef} aria-hidden="true" /><div className="orb-css" aria-hidden="true"><div className="orb-layer l0" /><div className="orb-layer l1" /><div className="orb-swirl" /><div className="orb-sheen" /></div><div className="orb-ring r1" aria-hidden="true" /><div className="orb-ring r2" aria-hidden="true" /><div className="orb-ring r3" aria-hidden="true" /><div className="orb-orbit" aria-hidden="true"><i /><i /><i /></div></div>;
});

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><span className="brand-mark-core" /></span>;
}

function Sidebar({ view, open, disabled, onView, onToggle, onCreate }: { view: View; open: boolean; disabled: boolean; onView: (view: View) => void; onToggle: () => void; onCreate: () => void }) {
  const links: Array<{ view: View; label: string; icon: IconName }> = [
    { view: "companion", label: "Companion", icon: "companion" },
    { view: "projects", label: "Projects", icon: "projects" },
    { view: "memory", label: "Memory", icon: "memory" },
  ];
  const navigate = (next: View) => onView(next);
  return <aside className={`sidebar${open ? " sidebar-open" : ""}`} aria-label="Main navigation"><div className="sidebar-panel"><div className="sb-top window-drag-region electrobun-webkit-app-region-drag"><button className="brand electrobun-webkit-app-region-no-drag" type="button" onClick={() => navigate("companion")} aria-label="PROTEUS home" title="PROTEUS home"><BrandMark /><span className="brand-word sb-label">PROTEUS</span></button><button className="sb-toggle electrobun-webkit-app-region-no-drag" type="button" onClick={onToggle} aria-label={open ? "Collapse sidebar" : "Expand sidebar"} aria-expanded={open}><Icon name="chevron" size={16} /></button></div><button className="sb-new electrobun-webkit-app-region-no-drag" type="button" onClick={onCreate} disabled={disabled} title={disabled ? "Available when the current response finishes" : "New chat"}><Icon name="new-chat" size={18} /><span className="sb-label">New chat</span></button><nav className="sb-menu" aria-label="Primary">{links.map((link) => <button className={`sb-link${view === link.view ? " active" : ""}`} type="button" key={link.view} onClick={() => navigate(link.view)} aria-current={view === link.view ? "page" : undefined} title={link.label}><Icon name={link.icon} /><span className="sb-label">{link.label}</span></button>)}</nav><div className="sb-bottom"><button className={`sb-link${view === "settings" ? " active" : ""}`} type="button" onClick={() => navigate("settings")} aria-current={view === "settings" ? "page" : undefined} title="Settings"><Icon name="settings" /><span className="sb-label">Settings</span></button></div></div></aside>;
}

function ConversationPopover({ snapshot, open, disabled, initialEditingId, onClose, onCreate, onSwitch, onRename, onDelete }: { snapshot: RuntimeSnapshot; open: boolean; disabled: boolean; initialEditingId?: string | null; onClose: () => void; onCreate: () => void; onSwitch: (threadId: string) => void; onRename: (threadId: string, title: string) => void; onDelete: (thread: ThreadSummary) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const groups = useMemo(() => groupThreads(snapshot.threads, query), [query, snapshot.threads]);
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) onClose(); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [onClose, open]);
  useEffect(() => {
    if (!open || !initialEditingId) return;
    const thread = snapshot.threads.find((item) => item.id === initialEditingId);
    if (thread && !disabled) { setEditingId(thread.id); setEditValue(thread.title); }
  }, [disabled, initialEditingId, open, snapshot.threads]);
  if (!open) return null;
  const beginEdit = (thread: ThreadSummary) => { if (disabled) return; setEditingId(thread.id); setEditValue(thread.title); };
  const cancelEdit = () => { setEditingId(null); setEditValue(""); };
  const saveEdit = (thread: ThreadSummary) => {
    const next = editValue.trim().slice(0, 80);
    if (next && next !== thread.title) onRename(thread.id, next);
    cancelEdit();
  };
  return <div className="conversation-popover" ref={rootRef} role="dialog" aria-label="Conversation history"><div className="conversation-popover-head"><div><span className="caption-uppercase">Conversations</span><p>Saved on this device</p></div><button type="button" className="icon-btn" onClick={() => { onCreate(); onClose(); }} disabled={disabled} aria-label="New chat" title={disabled ? "Available when the current response finishes" : "New chat"}><Icon name="plus" size={17} /></button></div><label className="conversation-search"><Icon name="search" size={15} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" /></label><div className="conversation-popover-list">{groups.length === 0 ? <p className="conversation-empty">{snapshot.threads.length === 0 ? "Your first chat will appear here." : "No conversations match your search."}</p> : groups.map((group) => <section key={group.name} className="conversation-group"><h3>{group.name}</h3>{group.threads.map((thread) => <div className={`conversation-row${thread.id === snapshot.activeThreadId ? " active" : ""}`} key={thread.id}>{editingId === thread.id ? <form className="conversation-edit" onSubmit={(event) => { event.preventDefault(); saveEdit(thread); }}><input autoFocus value={editValue} onChange={(event) => setEditValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelEdit(); } }} aria-label={`Rename ${thread.title}`} /><button type="submit" className="row-icon-action" aria-label="Save conversation name"><Icon name="check" size={14} /></button><button type="button" className="row-icon-action" onClick={cancelEdit} aria-label="Cancel rename"><Icon name="close" size={14} /></button></form> : <><button type="button" className="conversation-select" onClick={() => { onSwitch(thread.id); onClose(); }}><span className={`thread-activity ${thread.activity}`} aria-hidden="true" /><span className="conversation-row-copy"><b>{thread.title}</b><small>{thread.attention > 0 ? `${thread.attention} waiting` : relativeTime(thread.updatedAt)}</small></span></button><span className="conversation-row-actions"><button type="button" className="row-icon-action" onClick={() => beginEdit(thread)} disabled={disabled} aria-label={`Rename ${thread.title}`} title={disabled ? "Available when the current response finishes" : "Rename"}><Icon name="edit" size={14} /></button><button type="button" className="row-icon-action danger" onClick={() => onDelete(thread)} disabled={disabled} aria-label={`Delete ${thread.title}`} title={disabled ? "Available when the current response finishes" : "Delete"}><Icon name="trash" size={14} /></button></span></>}</div>)}</section>)}</div></div>;
}

function DeleteThreadModal({ thread, onCancel, onConfirm }: { thread: ThreadSummary; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); return; }
      if (event.key !== "Tab") return;
      const active = document.activeElement;
      if (event.shiftKey && active === cancelRef.current) { event.preventDefault(); confirmRef.current?.focus(); }
      else if (!event.shiftKey && active === confirmRef.current) { event.preventDefault(); cancelRef.current?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);
  return <div className="modal-backdrop" role="presentation"><div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-conversation-title" aria-describedby="delete-conversation-copy"><div className="modal-icon"><Trash2 size={18} strokeWidth={1.75} aria-hidden="true" /></div><h2 id="delete-conversation-title">Delete conversation?</h2><p id="delete-conversation-copy"><strong>{thread.title}</strong> will be removed from this device. This cannot be undone.</p><div className="modal-actions"><button ref={cancelRef} type="button" className="btn-outline sm" onClick={onCancel}>Cancel</button><button ref={confirmRef} type="button" className="btn-danger sm" onClick={onConfirm}>Delete</button></div></div></div>;
}

function PageHeader({ kicker, title, subtitle }: { kicker: string; title: string; subtitle: string }) { return <div className="page-head window-drag-region electrobun-webkit-app-region-drag"><p className="caption-uppercase">{kicker}</p><h1 className="display-lg">{title}</h1><p className="page-sub">{subtitle}</p></div>; }

function errorForUi(error: RuntimeError | null): ReactNode { if (!error) return null; return <div className={`runtime-alert ${error.code === "aborted" ? "muted" : "error"}`} role="status"><span>{error.message}</span></div>; }
function ignoreRpc(promise: Promise<unknown>): void { void promise.catch(() => undefined); }

function OrbPresence({ state, docked, animateDock, pulseVersion, orbRef }: { state: OrbState; docked: boolean; animateDock: boolean; pulseVersion: number; orbRef: MutableRefObject<OrbHandle | null> }) {
  const presenceRef = useRef<HTMLDivElement>(null);
  const previousRef = useRef<{ docked: boolean; orbRect: DOMRect; presenceRect: DOMRect } | null>(null);
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
      const animation = orb.animate([{ transform: `translate(${previous.orbRect.left - nextOrbRect.left}px, ${previous.orbRect.top - nextOrbRect.top}px) scale(${previous.orbRect.width / Math.max(nextOrbRect.width, 1)})` }, { transform: "translate(0px, 0px) scale(1)" }], { duration: 820, easing: "cubic-bezier(.25, 1.3, .4, 1)" });
      animation.onfinish = () => { orb.style.transform = ""; };
      presence.animate([{ height: `${previous.presenceRect.height}px`, opacity: 1 }, { height: `${nextPresenceRect.height}px`, opacity: 1 }], { duration: 640, easing: "cubic-bezier(.5, 0, .8, .35)" });
      orbRef.current?.pulse();
    }
    previousRef.current = { docked, orbRect: nextOrbRect, presenceRect: nextPresenceRect };
  }, [animateDock, docked, orbRef]);
  useEffect(() => { if (pulseVersion !== previousPulseRef.current) { orbRef.current?.pulse(); previousPulseRef.current = pulseVersion; } }, [orbRef, pulseVersion]);
  return <div ref={presenceRef} className={`orb-presence ${docked ? "orb-presence-docked" : "orb-presence-hero"}`}><div className="orb-frame"><Orb ref={orbRef} state={state} /></div><div className="orb-meta"><span className="orb-state-label">{spec.label}</span><span className="orb-state-desc">{spec.description}</span></div></div>;
}

function useConversationOrbState(snapshot: RuntimeSnapshot): { state: OrbState; pulseVersion: number } {
  const [state, setState] = useState<OrbState>("idle");
  const [pulseVersion, setPulseVersion] = useState(0);
  const previousRef = useRef<{ threadId: string | null; runId: string | null; runStatus: string | null } | null>(null);
  const transientRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  useEffect(() => {
    const previous = previousRef.current;
    const threadChanged = previous !== null && previous.threadId !== snapshot.activeThreadId;
    const activeRun = snapshot.activeRun?.threadId === snapshot.activeThreadId ? snapshot.activeRun : null;
    const clearTimers = () => { timersRef.current.forEach((timer) => window.clearTimeout(timer)); timersRef.current = []; transientRef.current = false; };
    const sequence = (steps: Array<{ state: OrbState; duration: number }>) => { clearTimers(); transientRef.current = true; let elapsed = 0; setState(steps[0].state); steps.slice(1).forEach((step, index) => { elapsed += steps[index].duration; timersRef.current.push(window.setTimeout(() => { setState(step.state); if (index === steps.length - 2) { transientRef.current = false; timersRef.current = []; } }, elapsed)); }); };
    if (threadChanged) clearTimers();
    if (activeRun?.status === "running") { clearTimers(); setState(snapshot.messages.some((message) => message.status === "streaming") ? "working" : "thinking"); }
    else if (!threadChanged && previous?.runStatus === "running" && previous.runId) {
      if (snapshot.error?.code === "aborted" || activeRun?.status === "aborted") sequence([{ state: "interrupted", duration: 1400 }, { state: "recovery", duration: 1300 }, { state: "idle", duration: 0 }]);
      else if (!snapshot.error) { setPulseVersion((value) => value + 1); sequence([{ state: "done", duration: 1400 }, { state: "idle", duration: 0 }]); }
      else { clearTimers(); setState("recovery"); }
    } else if (!transientRef.current) setState(snapshot.error?.code === "aborted" || snapshot.workbench.status === "waiting" ? "idle" : snapshot.error ? "recovery" : "idle");
    previousRef.current = { threadId: snapshot.activeThreadId, runId: activeRun?.runId ?? null, runStatus: activeRun?.status ?? null };
  }, [snapshot]);
  useEffect(() => () => timersRef.current.forEach((timer) => window.clearTimeout(timer)), []);
  return { state, pulseVersion };
}

function useSmartScroll(itemKey: string): { threadRef: MutableRefObject<HTMLDivElement | null>; showLatest: boolean; jumpLatest: () => void } {
  const threadRef = useRef<HTMLDivElement>(null);
  const [showLatest, setShowLatest] = useState(false);
  const nearBottomRef = useRef(true);
  useEffect(() => {
    const element = threadRef.current;
    if (!element) return;
    const update = () => { nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96; setShowLatest(!nearBottomRef.current); };
    update();
    element.addEventListener("scroll", update, { passive: true });
    return () => element.removeEventListener("scroll", update);
  }, []);
  useLayoutEffect(() => {
    const element = threadRef.current;
    if (!element || !nearBottomRef.current) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [itemKey]);
  return { threadRef, showLatest, jumpLatest: () => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }); setShowLatest(false); nearBottomRef.current = true; } };
}

function MessageActions({ message, onRetry, onContinue }: { message: ChatMessage; onRetry?: () => void; onContinue?: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { const pending = navigator.clipboard?.writeText(message.text); if (pending) void pending.then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); }); };
  return <div className="message-actions"><button type="button" className="message-action" onClick={copy} aria-label="Copy message"><Icon name="copy" size={13} />{copied ? "Copied" : "Copy"}</button>{message.status === "error" && message.retryable && onRetry && <button type="button" className="message-action" onClick={onRetry}><Icon name="retry" size={13} /> Retry</button>}{message.status === "interrupted" && onContinue && <button type="button" className="message-action" onClick={onContinue}><Icon name="play" size={13} /> Continue</button>}</div>;
}

function MessageView({ message, onRetry, onContinue }: { message: ChatMessage; onRetry?: () => void; onContinue?: () => void }) {
  if (message.role === "user") return <div className="msg user"><div className="bubble"><span>{message.text}</span><MessageActions message={message} /></div></div>;
  return <div className={`msg ai message-${message.status}`}><div className="msg-body"><div className="msg-text markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code({ children, className, ...props }) { const value = String(children).replace(/\n$/, ""); return className ? <div className="code-wrap"><button type="button" className="code-copy" onClick={() => { const pending = navigator.clipboard?.writeText(value); if (pending) void pending; }} aria-label="Copy code"><Icon name="copy" size={12} /></button><code className={className} {...props}>{children}</code></div> : <code {...props}>{children}</code>; } }}>{message.text}</ReactMarkdown>{message.status === "streaming" && <span className="stream-caret" aria-label="Streaming">▍</span>}</div>{(message.status === "interrupted" || message.status === "error") && <span className="message-status">{message.status === "interrupted" ? "Stopped" : "Response failed"}</span>}<MessageActions message={message} onRetry={onRetry} onContinue={onContinue} /></div></div>;
}

function InteractionCard({ interaction, onRespond }: { interaction: PendingInteraction; onRespond: (toolCallId: string, response: unknown) => void }) {
  const [answer, setAnswer] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const isPlan = interaction.kind === "submit_plan";
  const resolving = interaction.status === "resolving";
  const submit = () => {
    if (resolving) return;
    if (isPlan) onRespond(interaction.toolCallId, { action: "approved", feedback: feedback.trim() || undefined });
    else onRespond(interaction.toolCallId, interaction.options.length > 0 && interaction.selectionMode === "multi_select" ? selected : interaction.options.length > 0 ? selected[0] ?? "" : answer.trim());
  };
  const toggle = (label: string) => setSelected((current) => current.includes(label) ? current.filter((value) => value !== label) : [...current, label]);
  return <article className={`interaction-card interaction-${interaction.kind}${resolving ? " resolving" : ""}`} id={`interaction-${interaction.id}`}><div className="interaction-kicker">{resolving ? "Sending response…" : isPlan ? "Plan approval" : "Your input needed"}</div><h3>{interaction.title}</h3>{interaction.question && <p>{interaction.question}</p>}{isPlan && interaction.plan && <div className="plan-preview"><strong>{interaction.plan.title}</strong>{interaction.plan.raw ? <div className="plan-markdown markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{interaction.plan.raw}</ReactMarkdown></div> : <><p>{interaction.plan.summary}</p>{interaction.plan.steps.length > 0 && <ol>{interaction.plan.steps.map((step) => <li key={step}>{step}</li>)}</ol>}</>}</div>}{!isPlan && interaction.options.length > 0 && <div className={`interaction-options ${interaction.selectionMode === "multi_select" ? "multi" : ""}`}>{interaction.options.map((option) => <label key={option.label} className={`interaction-option${selected.includes(option.label) ? " selected" : ""}`}><input disabled={resolving} type={interaction.selectionMode === "multi_select" ? "checkbox" : "radio"} name={interaction.id} checked={selected.includes(option.label)} onChange={() => interaction.selectionMode === "multi_select" ? toggle(option.label) : setSelected([option.label])} /><span><b>{option.label}</b>{option.description && <small>{option.description}</small>}</span></label>)}</div>}{!isPlan && interaction.options.length === 0 && <textarea disabled={resolving} className="interaction-input" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Type your answer…" rows={2} />}{isPlan && <textarea disabled={resolving} className="interaction-input" value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Optional feedback or requested changes" rows={2} />}<div className="interaction-actions">{isPlan && <button disabled={resolving} type="button" className="btn-outline sm" onClick={() => onRespond(interaction.toolCallId, { action: "rejected", feedback: feedback.trim() || "Please revise the plan." })}>Request changes</button>}<button type="button" className="btn-primary sm" onClick={submit} disabled={resolving || !isPlan && interaction.options.length > 0 && selected.length === 0 || !isPlan && interaction.options.length === 0 && !answer.trim()}>{isPlan ? "Approve plan" : "Send answer"}</button></div></article>;
}

function ResolvedInteraction({ interaction }: { interaction: PendingInteraction }) {
  const isPlan = interaction.kind === "submit_plan";
  return <div className={`resolved-item${isPlan ? " resolved-plan" : ""}`}><span className={`resolved-dot ${interaction.status}`} /><div className="resolved-copy"><span>{isPlan ? `${interaction.plan?.title ?? interaction.title}${interaction.plan?.version ? ` · v${interaction.plan.version}` : ""}` : interaction.title}</span>{isPlan && interaction.plan && <div className="resolved-plan-body">{interaction.plan.raw ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{interaction.plan.raw}</ReactMarkdown> : <><p>{interaction.plan.summary}</p>{interaction.plan.steps.length > 0 && <ol>{interaction.plan.steps.map((step) => <li key={step}>{step}</li>)}</ol>}</>}{interaction.plan.feedback && <small>Feedback: {interaction.plan.feedback}</small>}</div>}</div><small>{interaction.status}</small></div>;
}

function Workbench({ snapshot, open, onClose, onQueueUpdate, onQueueRemove, onQueueRestore, onJump }: { snapshot: RuntimeSnapshot; open: boolean; onClose: () => void; onQueueUpdate: (item: QueuedFollowUp) => void; onQueueRemove: (id: string) => void; onQueueRestore: (id: string) => void; onJump: (id: string) => void }) {
  const wb = snapshot.workbench;
  const attentionItems = wb.pendingInteractions.filter((item) => item.status === "pending");
  const [editingId, setEditingId] = useState<string | null>(null);
  const totalTokens = wb.tokenUsage.totalTokens;
  const statusLabel = attentionItems.length > 0 ? "Needs you" : wb.status === "complete" ? "Done" : wb.status === "active" ? "Active" : wb.status === "waiting" ? "Waiting" : wb.status === "interrupted" ? "Interrupted" : wb.status === "error" ? "Error" : "Current";
  if (!open) return null;
  return <><button type="button" className="workbench-scrim" onClick={onClose} aria-label="Close Workbench" /><aside className="workbench" aria-label="Conversation Workbench"><div className="workbench-live"><div className="wb-head"><div className="wb-head-main"><span className="caption-uppercase">Current work</span><h2>{wb.goal || goalFromMessages(snapshot.messages)}</h2></div><div className="wb-head-actions"><span className={`badge-pill wb-status ${wb.status}`}>{statusLabel}</span><button className="icon-btn wb-close" type="button" onClick={onClose} aria-label="Close Workbench"><Icon name="close" size={16} /></button></div></div><div className="wb-groups">{attentionItems.length > 0 && <section className="wb-group wb-attention"><div className="wb-group-title"><span>Attention required</span><b>{attentionItems.length}</b></div>{attentionItems.map((item) => <button type="button" className="wb-link" key={item.id} onClick={() => onJump(item.id)}>{item.kind === "submit_plan" ? "Plan approval" : item.title}<Icon name="arrow-right" size={13} /></button>)}</section>}{wb.tasks.length > 0 && <section className="wb-group"><div className="wb-group-title"><span>Plan & tasks</span><span>{wb.tasks.filter((task) => task.status === "completed").length}/{wb.tasks.length}</span></div><ul className="wb-steps">{wb.tasks.map((task: WorkbenchTask) => <li key={task.id} className={task.status}><span className="task-check">{task.status === "completed" ? <Icon name="check" size={11} /> : task.status === "in_progress" ? "•" : ""}</span><span>{task.status === "in_progress" ? task.activeForm : task.content}</span></li>)}</ul></section>}{(snapshot.activeRun || wb.activeTools.length > 0) && <section className="wb-group"><div className="wb-group-title"><span>Current activity</span><span className={`wb-status ${wb.status}`}>{wb.status}</span></div>{wb.activeTools.length > 0 ? <ul className="wb-tools">{wb.activeTools.map((tool) => <li key={tool.id}><span className="tool-pulse" />{tool.name}<small>{tool.status}</small></li>)}</ul> : <p className="wb-muted">{wb.status === "waiting" ? "Waiting for your response." : "PROTEUS is working through this turn."}</p>}</section>}{wb.queuedFollowUps.length > 0 && <section className="wb-group"><div className="wb-group-title"><span>Queued follow-ups</span><b>{wb.queuedFollowUps.length}</b></div><ol className="wb-queue">{wb.queuedFollowUps.map((item) => <li key={item.id}>{editingId === item.id ? <input autoFocus defaultValue={item.content} onBlur={(event) => { onQueueUpdate({ ...item, content: event.target.value }); setEditingId(null); }} onKeyDown={(event) => { if (event.key === "Enter") { onQueueUpdate({ ...item, content: event.currentTarget.value }); setEditingId(null); } if (event.key === "Escape") setEditingId(null); }} /> : <><span>{item.content}</span><span className="wb-row-actions"><button type="button" onClick={() => setEditingId(item.id)}>Edit</button><button type="button" onClick={() => onQueueRemove(item.id)}>Remove</button></span></>}</li>)}</ol></section>}{wb.clearedFollowUps.length > 0 && <section className="wb-group"><div className="wb-group-title"><span>Cleared by steering</span><span>{wb.clearedFollowUps.length}</span></div><ul className="wb-cleared">{wb.clearedFollowUps.slice(-4).map((item) => <li key={item.id}><span>{item.content}</span><button type="button" onClick={() => onQueueRestore(item.id)}>Restore</button></li>)}</ul></section>}{totalTokens > 0 && <details className="wb-session"><summary><span>Session details</span><ChevronDown size={14} strokeWidth={1.75} /></summary><dl><div><dt>Prompt tokens</dt><dd>{wb.tokenUsage.promptTokens.toLocaleString()}</dd></div><div><dt>Completion</dt><dd>{wb.tokenUsage.completionTokens.toLocaleString()}</dd></div><div><dt>Total</dt><dd>{totalTokens.toLocaleString()}</dd></div></dl></details>}</div></div></aside></>;
}

function Companion({ snapshot, activeTitle, input, setInput, onSend, onSteer, onAbort, onSettings, onCreate, onSwitch, onRename, onDeleteRequest, onOrbState, onRetry, onContinue, onInteraction, onQueueUpdate, onQueueRemove, onQueueRestore }: { snapshot: RuntimeSnapshot; activeTitle: string; input: string; setInput: (value: string) => void; onSend: (event: FormEvent<HTMLFormElement>) => void; onSteer: () => void; onAbort: () => void; onSettings: () => void; onCreate: () => void; onSwitch: (threadId: string) => void; onRename: (threadId: string, title: string) => void; onDeleteRequest: (thread: ThreadSummary) => void; onOrbState: (state: OrbState) => void; onRetry: (messageId: string) => void; onContinue: (messageId: string) => void; onInteraction: (toolCallId: string, response: unknown) => void; onQueueUpdate: (item: QueuedFollowUp) => void; onQueueRemove: (id: string) => void; onQueueRestore: (id: string) => void }) {
  const runningForSelected = snapshot.activeRun?.status === "running" && snapshot.activeRun.threadId === snapshot.activeThreadId;
  const runningElsewhere = snapshot.activeRun?.status === "running" && !runningForSelected;
  const selectedModel = snapshot.models.find((model) => model.id === snapshot.selectedModelId);
  const canChat = snapshot.credential.verified && snapshot.activeThreadId !== null && snapshot.status !== "error" && !runningElsewhere;
  const { state, pulseVersion } = useConversationOrbState(snapshot);
  const orbRef = useRef<OrbHandle>(null);
  const titleRef = useRef<HTMLButtonElement>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [renameRequest, setRenameRequest] = useState<string | null>(null);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [dockedThreads, setDockedThreads] = useState<Set<string>>(() => new Set());
  const previousThreadRef = useRef(snapshot.activeThreadId);
  const structuredRunRef = useRef(false);
  const lastMessage = snapshot.messages[snapshot.messages.length - 1];
  const { threadRef, showLatest, jumpLatest } = useSmartScroll(`${snapshot.activeThreadId ?? "none"}:${lastMessage?.id ?? "none"}:${lastMessage?.text.length ?? 0}:${snapshot.interactions.length}`);
  const workbenchHasContent = shouldShowWorkbench(snapshot.workbench);
  const liveWorkbenchSignal = snapshot.workbench.pendingInteractions.length > 0 || snapshot.workbench.activeTools.length > 0 || snapshot.workbench.tasks.some((task) => task.status !== "completed") || snapshot.workbench.queuedFollowUps.length > 0 || snapshot.workbench.status === "waiting";
  const titleTriggerClose = () => { setSessionsOpen(false); setRenameRequest(null); };
  useEffect(() => { onOrbState(state); }, [onOrbState, state]);
  useEffect(() => { if (!snapshot.activeThreadId || (!snapshot.messages.length && !snapshot.activeRun)) return; setDockedThreads((current) => current.has(snapshot.activeThreadId as string) ? current : new Set(current).add(snapshot.activeThreadId as string)); }, [snapshot.activeRun, snapshot.messages.length, snapshot.activeThreadId]);
  useEffect(() => {
    const threadChanged = previousThreadRef.current !== snapshot.activeThreadId;
    if (threadChanged) { setWorkbenchOpen(false); structuredRunRef.current = false; }
    if (liveWorkbenchSignal) { structuredRunRef.current = true; setWorkbenchOpen(true); }
    else if (snapshot.activeRun && !liveWorkbenchSignal) setWorkbenchOpen(false);
    else if (!snapshot.activeRun && structuredRunRef.current && workbenchHasContent) setWorkbenchOpen(true);
    previousThreadRef.current = snapshot.activeThreadId;
  }, [liveWorkbenchSignal, snapshot.activeRun, snapshot.activeThreadId, workbenchHasContent]);
  useEffect(() => {
    if (!sessionsOpen) titleRef.current?.focus();
  }, [sessionsOpen]);
  const docked = !!snapshot.activeThreadId && (snapshot.messages.length > 0 || !!snapshot.activeRun || dockedThreads.has(snapshot.activeThreadId));
  const animateDock = !!snapshot.activeThreadId && runningForSelected && !dockedThreads.has(snapshot.activeThreadId);
  const lastErrorMessage = [...snapshot.messages].reverse().find((message) => message.status === "error");
  const jumpToInteraction = (id: string) => { document.getElementById(`interaction-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); };
  return <section className="view active"><div className="chat-titlebar window-drag-region electrobun-webkit-app-region-drag"><div className="chat-title-copy"><p className="caption-uppercase">Active conversation</p><button ref={titleRef} className="chat-title-trigger electrobun-webkit-app-region-no-drag" type="button" onClick={() => { setRenameRequest(null); setSessionsOpen((value) => !value); }} onDoubleClick={() => { if (!snapshot.activeThreadId || snapshot.activeRun) return; setRenameRequest(snapshot.activeThreadId); setSessionsOpen(true); }} aria-expanded={sessionsOpen} aria-haspopup="dialog"><h1 className="chat-title">{activeTitle}</h1><Icon name="down" size={18} /></button></div><div className="chat-title-actions electrobun-webkit-app-region-no-drag">{workbenchHasContent && <button type="button" className={`title-icon-button${workbenchOpen ? " active" : ""}`} onClick={() => setWorkbenchOpen((value) => !value)} aria-expanded={workbenchOpen} aria-label={workbenchOpen ? "Close Workbench" : "Open Workbench"} title={workbenchOpen ? "Close Workbench" : "Open Workbench"}><Icon name="panel" size={17} />{snapshot.workbench.pendingInteractions.length > 0 && <span className="title-attention-badge">{snapshot.workbench.pendingInteractions.length}</span>}</button>}</div><ConversationPopover snapshot={snapshot} open={sessionsOpen} disabled={snapshot.activeRun !== null} initialEditingId={renameRequest} onClose={titleTriggerClose} onCreate={onCreate} onSwitch={onSwitch} onRename={onRename} onDelete={onDeleteRequest} /></div><div className={`text-chat-layout ${workbenchOpen ? "workbench-visible" : ""}`}><div className={`companion-grid ${workbenchOpen ? "workbench-open" : "workbench-closed"}`}><div className="stage">{runningElsewhere && <div className="other-run-note">Another conversation is running. You can browse this chat while it finishes.</div>}<OrbPresence state={state} docked={docked} animateDock={animateDock} pulseVersion={pulseVersion} orbRef={orbRef} /><div className="thread" ref={threadRef} aria-live="polite">{snapshot.messages.map((message) => <MessageView key={message.id} message={message} onRetry={message.status === "error" ? () => onRetry(message.id) : undefined} onContinue={message.status === "interrupted" ? () => onContinue(message.id) : undefined} />)}{snapshot.events.map((event: ChatEvent) => <div className="chat-event" key={event.id}>{event.text}</div>)}{snapshot.interactions.map((interaction) => <InteractionCard key={interaction.id} interaction={interaction} onRespond={onInteraction} />)}{snapshot.resolvedInteractions.length > 0 && <details className="resolved-interactions"><summary>Previous decisions ({snapshot.resolvedInteractions.length})</summary>{snapshot.resolvedInteractions.slice(-8).map((item) => <ResolvedInteraction key={`${item.id}-${item.status}`} interaction={item} />)}</details>}{snapshot.error && snapshot.error.code !== "aborted" && <div className="run-error-card"><div><strong>That turn did not finish.</strong><p>{snapshot.error.message}</p></div>{snapshot.error.retryable && lastErrorMessage && <button type="button" className="btn-outline sm" onClick={() => onRetry(lastErrorMessage.id)}><Icon name="retry" size={14} /> Retry</button>}</div>}{snapshot.error?.code === "aborted" && <div className="run-stopped-note">Response stopped. You can continue from the partial answer above.</div>}</div>{showLatest && <button type="button" className="latest-btn" onClick={jumpLatest}><Icon name="latest" size={14} /> Latest</button>}<div className="chat-context-row"><span>{selectedModel?.name ?? snapshot.selectedModelId}</span><span>via OpenRouter</span><span className={`runtime-dot ${snapshot.credential.verified ? "ok" : "off"}`} />{snapshot.credential.verified ? "Connected" : <button className="btn-tertiary" type="button" onClick={onSettings}>Connect a key</button>}</div><form className={`composer${canChat ? "" : " disabled"}`} onSubmit={onSend} autoComplete="off"><input className="composer-input" value={input} onChange={(event) => { setInput(event.target.value); orbRef.current?.nudge(); }} placeholder={runningElsewhere ? "Another conversation is running…" : canChat ? "Message PROTEUS…" : "Connect OpenRouter in Settings to chat"} aria-label="Message PROTEUS" disabled={!canChat} maxLength={32_000} />{runningForSelected && <button type="button" className="stop-btn composer-stop" onClick={onAbort}><Icon name="stop" size={14} /> Stop</button>}{runningForSelected && <button type="button" className="steer-btn" onClick={onSteer} disabled={!input.trim()}><Icon name="steer" size={14} /> Steer</button>}<button className="send-btn" type="submit" aria-label="Send" disabled={!canChat || !input.trim()}><Icon name="send" size={18} /></button></form></div><Workbench snapshot={snapshot} open={workbenchOpen} onClose={() => setWorkbenchOpen(false)} onQueueUpdate={onQueueUpdate} onQueueRemove={onQueueRemove} onQueueRestore={onQueueRestore} onJump={jumpToInteraction} /></div></div></section>;
}

function SettingsView({ snapshot, apiKey, setApiKey, onConnect, onDisconnect, onRefresh, onSelectModel }: { snapshot: RuntimeSnapshot; apiKey: string; setApiKey: (value: string) => void; onConnect: (event: FormEvent<HTMLFormElement>) => void; onDisconnect: () => void; onRefresh: () => void; onSelectModel: (modelId: OpenRouterModel["id"]) => void }) {
  const selected = snapshot.models.find((model) => model.id === snapshot.selectedModelId);
  const price = (value: number | undefined) => value === undefined ? "—" : `$${(value * 1_000_000).toFixed(2)}/M`;
  return <section className="view active"><div className="page-narrow"><PageHeader kicker="Yours to control" title="Settings" subtitle="One provider, one secure key, and a live OpenRouter text-model catalog." /><section className="card settings-card"><h2 className="title-md">OpenRouter connection</h2><p className="settings-intro">Your key is checked before it is stored securely on this device.</p><form className="key-form" onSubmit={onConnect}><Icon name="key" size={18} /><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={snapshot.credential.configured ? "Enter a replacement key" : "sk-or-v1-…"} autoComplete="off" aria-label="OpenRouter API key" /><button className="btn-primary sm" type="submit" disabled={!apiKey.trim() || snapshot.status === "validating-key"}>{snapshot.status === "validating-key" ? "Checking…" : snapshot.credential.configured ? "Replace key" : "Connect key"}</button></form><div className="connection-status"><span className={`runtime-dot ${snapshot.credential.verified ? "ok" : "off"}`} />{snapshot.credential.verified ? "Verified with OpenRouter" : snapshot.credential.configured ? "Key saved but not verified" : "No key connected"}{snapshot.credential.configured && <button className="btn-danger-ghost" type="button" onClick={onDisconnect}>Disconnect</button>}</div>{errorForUi(snapshot.error)}</section><section className="card settings-card"><div className="settings-section-head"><div><h2 className="title-md">Text model</h2><p className="settings-intro">Choose the text model used for new conversations.</p></div><button className="btn-outline sm" type="button" onClick={onRefresh} disabled={!snapshot.credential.verified || snapshot.status === "loading-models"}><Icon name="refresh" size={15} /> Refresh</button></div><div className="model-picker"><label htmlFor="model-select">Selected model</label><select id="model-select" className="settings-select model-select" value={snapshot.selectedModelId} onChange={(event) => onSelectModel(event.target.value as OpenRouterModel["id"])} disabled={!snapshot.credential.verified || snapshot.activeRun !== null}>{snapshot.models.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.id}</option>)}</select></div>{selected && <div className="model-meta"><span>{selected.contextLength ? `${selected.contextLength.toLocaleString()} token context` : "OpenRouter-managed context"}</span><span>Prompt {price(selected.promptPrice)}</span><span>Completion {price(selected.completionPrice)}</span></div>}</section></div></section>;
}

function Projects() { return <section className="view active"><div className="page-narrow"><PageHeader kicker="Your contexts" title="Projects" subtitle="Keep longer-running work organized around the conversations that matter." /><div className="card"><p>Projects will be available here when you are ready to organize longer-running work.</p></div></div></section>; }
function Memory() { return <section className="view active"><div className="page-narrow"><PageHeader kicker="Conversation history" title="Memory" subtitle="Conversation history stays on this device. You decide what should be kept for later." /><div className="card"><p>Long-term memory is not enabled yet. Your conversation history remains available in its chat.</p></div></div></section>; }

export default function App() {
  const [view, setView] = useState<View>("companion");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [input, setInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [, setOrbState] = useState<OrbState>("idle");
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(DEFAULT_SNAPSHOT);
  const [deleteTarget, setDeleteTarget] = useState<ThreadSummary | null>(null);
  useEffect(() => {
    const applyEnvelope = (envelope: RuntimeSnapshotEnvelope) => {
      try {
        setSnapshot(decodeRuntimeSnapshot(envelope));
      } catch {
        setSnapshot((current) => ({
          ...current,
          status: "error",
          error: { code: "unknown", message: "A runtime update could not be decoded. Restart PROTEUS and try again.", retryable: true },
        }));
      }
    };
    const onChanged = (next: RuntimeSnapshotEnvelope) => applyEnvelope(next);
    rpc.addMessageListener("runtime.changed", onChanged);
    void rpc.request["runtime.bootstrap"]().then(applyEnvelope).catch(() => setSnapshot((current) => ({ ...current, status: "offline", error: { code: "offline", message: "The desktop runtime is not reachable.", retryable: true } })));
    return () => rpc.removeMessageListener("runtime.changed", onChanged);
  }, []);
  useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if (event.defaultPrevented) return; if (event.key === "Escape" && snapshot.activeRun) ignoreRpc(rpc.request["chat.abort"]()); }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [snapshot.activeRun]);
  const activeTitle = useMemo(() => snapshot.threads.find((thread) => thread.id === snapshot.activeThreadId)?.title ?? "New chat", [snapshot.threads, snapshot.activeThreadId]);
  const handleNavigate = (next: View) => { setView(next); setSidebarOpen(false); };
  const handleSend = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const text = input.trim(); if (!text) return; ignoreRpc(rpc.request["chat.send"]({ text }).then((result) => { if (result.accepted) setInput(""); })); };
  const handleSteer = () => { const text = input.trim(); if (!text) return; ignoreRpc(rpc.request["chat.steer"]({ text }).then((result) => { if (result.accepted) setInput(""); })); };
  const handleConnect = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const candidate = apiKey; setApiKey(""); ignoreRpc(rpc.request["credentials.connect"]({ apiKey: candidate })); };
  const handleCreate = () => { if (snapshot.activeRun) return; setSidebarOpen(false); ignoreRpc(rpc.request["threads.create"]({ title: "New chat" })); };
  const handleRename = (threadId: string, title: string) => { ignoreRpc(rpc.request["threads.rename"]({ threadId, title })); };
  const handleDeleteConfirm = () => { if (!deleteTarget) return; const target = deleteTarget; setDeleteTarget(null); ignoreRpc(rpc.request["threads.delete"]({ threadId: target.id })); };
  return <><div className="ambient" aria-hidden="true"><div className="ambient-orb amb-mint" /><div className="ambient-orb amb-lavender" /><div className="ambient-orb amb-sky" /></div><div className="app-shell"><Sidebar view={view} open={sidebarOpen} disabled={snapshot.activeRun !== null} onView={handleNavigate} onToggle={() => setSidebarOpen((value) => !value)} onCreate={handleCreate} />{sidebarOpen && <button type="button" className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" /> }<main>{view === "companion" && <Companion snapshot={snapshot} activeTitle={activeTitle} input={input} setInput={setInput} onSend={handleSend} onSteer={handleSteer} onAbort={() => ignoreRpc(rpc.request["chat.abort"]())} onSettings={() => handleNavigate("settings")} onCreate={handleCreate} onSwitch={(threadId) => ignoreRpc(rpc.request["threads.select"]({ threadId }))} onRename={handleRename} onDeleteRequest={setDeleteTarget} onOrbState={setOrbState} onRetry={(messageId) => ignoreRpc(rpc.request["chat.retry"]({ messageId }))} onContinue={(messageId) => ignoreRpc(rpc.request["chat.continue"]({ messageId }))} onInteraction={(toolCallId, response) => ignoreRpc(rpc.request["chat.interaction.respond"]({ toolCallId, response }))} onQueueUpdate={(item) => ignoreRpc(rpc.request["chat.queue.update"]({ id: item.id, content: item.content }))} onQueueRemove={(id) => ignoreRpc(rpc.request["chat.queue.remove"]({ id }))} onQueueRestore={(id) => ignoreRpc(rpc.request["chat.queue.restore"]({ id }))} />}{view === "projects" && <Projects />}{view === "memory" && <Memory />}{view === "settings" && <SettingsView snapshot={snapshot} apiKey={apiKey} setApiKey={setApiKey} onConnect={handleConnect} onDisconnect={() => ignoreRpc(rpc.request["credentials.disconnect"]())} onRefresh={() => ignoreRpc(rpc.request["models.refresh"]())} onSelectModel={(modelId) => ignoreRpc(rpc.request["models.select"]({ modelId }))} />}</main></div>{deleteTarget && <DeleteThreadModal thread={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={handleDeleteConfirm} />}</>;
}
