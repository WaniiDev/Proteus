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
import type {
  ChatMessage,
  OpenRouterModel,
  OrbState,
  RuntimeError,
  RuntimeSnapshot,
  ThreadSummary,
} from "../shared/contracts";
import { ORB_STATES } from "./orb-spec";
import { mountOrb, type OrbFX } from "./orb3d";
import { rpc } from "./bridge";

type View = "companion" | "projects" | "memory" | "settings";

const DEFAULT_SNAPSHOT: RuntimeSnapshot = {
  status: "booting",
  credential: { configured: false, verified: false },
  models: [{ id: "openrouter/auto", rawId: "auto", name: "Auto Router", inputModalities: ["text"], outputModalities: ["text"] }],
  selectedModelId: "openrouter/auto",
  threads: [],
  activeThreadId: null,
  messages: [],
  activeRun: null,
  error: null,
};

type IconName = "companion" | "projects" | "memory" | "settings" | "send" | "stop" | "chevron" | "plus" | "trash" | "refresh" | "key" | "edit";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "companion": return <svg {...common}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></svg>;
    case "projects": return <svg {...common}><path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h3l2 2.5h7.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5V7.5" /></svg>;
    case "memory": return <svg {...common}><path d="M12 3.5l7.5 4.3v8.4L12 20.5l-7.5-4.3V7.8L12 3.5z" /><circle cx="12" cy="12" r="2.2" /></svg>;
    case "settings": return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8" /></svg>;
    case "send": return <svg {...common}><path d="M12 19V5M5 12l7-7 7 7" /></svg>;
    case "stop": return <svg {...common} fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>;
    case "chevron": return <svg {...common}><path d="M15 5l-7 7 7 7" /></svg>;
    case "plus": return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "trash": return <svg {...common}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>;
    case "refresh": return <svg {...common}><path d="M20 11a8 8 0 0 0-14.7-3L3 11m0 0V5m0 6h6M4 13a8 8 0 0 0 14.7 3L21 13m0 0v6m0-6h-6" /></svg>;
    case "key": return <svg {...common}><circle cx="8" cy="15" r="3.5" /><path d="M10.5 12.5L19 4m-3 3 2 2m-5 1 2 2" /></svg>;
    case "edit": return <svg {...common}><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3zM14.5 7.5l2 2" /></svg>;
  }
}

export type OrbHandle = {
  pulse: () => void;
  nudge: () => void;
};

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

  useImperativeHandle(ref, () => ({
    pulse: () => controllerRef.current?.pulse(),
    nudge: () => controllerRef.current?.nudge(),
  }), []);

  useEffect(() => {
    controllerRef.current?.setState(state);
  }, [state]);

  return <div className="orb-float" ref={floatRef} data-state={state}>
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
    <div className="orb-orbit" aria-hidden="true"><i /><i /><i /></div>
  </div>;
});

function Sidebar({ view, collapsed, orbState, onView, onToggle }: { view: View; collapsed: boolean; orbState: OrbState; onView: (view: View) => void; onToggle: () => void }) {
  const links: Array<{ view: View; label: string; icon: IconName }> = [
    { view: "companion", label: "Companion", icon: "companion" },
    { view: "projects", label: "Projects", icon: "projects" },
    { view: "memory", label: "Memory", icon: "memory" },
    { view: "settings", label: "Settings", icon: "settings" },
  ];
  const spec = ORB_STATES[orbState];
  return <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
    <div className="sb-top window-drag-region electrobun-webkit-app-region-drag">
      <button className="brand electrobun-webkit-app-region-no-drag" type="button" onClick={() => onView("companion")} aria-label="PROTEUS home"><span className="brand-orb" aria-hidden="true" /><span className="brand-word sb-label">PROTEUS</span></button>
      <button className="sb-toggle electrobun-webkit-app-region-no-drag" type="button" onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed}><Icon name="chevron" size={16} /></button>
    </div>
    <nav className="sb-menu" aria-label="Primary">{links.map((link) => <button className={`sb-link${view === link.view ? " active" : ""}`} type="button" key={link.view} onClick={() => onView(link.view)} aria-current={view === link.view ? "page" : undefined}><Icon name={link.icon} /><span className="sb-label">{link.label}</span></button>)}</nav>
    <div className="sb-bottom"><span className="presence" title="PROTEUS status"><span className="presence-dot" style={{ background: `radial-gradient(circle at 35% 30%, ${spec.a}, ${spec.b})` }} /> <span className="sb-label">{spec.label}</span></span></div>
  </aside>;
}

function PageHeader({ kicker, title, subtitle }: { kicker: string; title: string; subtitle: string }) {
  return <div className="page-head window-drag-region electrobun-webkit-app-region-drag"><p className="caption-uppercase">{kicker}</p><h1 className="display-lg">{title}</h1><p className="page-sub">{subtitle}</p></div>;
}

function ThreadList({ snapshot, disabled, onCreate, onSwitch, onDelete }: { snapshot: RuntimeSnapshot; disabled: boolean; onCreate: () => void; onSwitch: (threadId: string) => void; onDelete: (thread: ThreadSummary) => void }) {
  return <aside className="chat-sidebar" aria-label="Conversations">
    <div className="chat-sidebar-head"><div><p className="caption-uppercase">Conversations</p><p className="chat-sidebar-sub">Saved on this device</p></div><button className="icon-btn" type="button" onClick={onCreate} disabled={disabled} aria-label="New chat"><Icon name="plus" size={17} /></button></div>
    <div className="chat-list">{snapshot.threads.length === 0 ? <p className="chat-list-empty">Your first chat will appear here.</p> : snapshot.threads.map((thread) => <div className={`chat-list-item${thread.id === snapshot.activeThreadId ? " active" : ""}`} key={thread.id}><button type="button" className="chat-list-select" onClick={() => onSwitch(thread.id)} disabled={disabled}><span className="chat-list-title">{thread.title}</span><span className="chat-list-date">{new Date(thread.updatedAt).toLocaleDateString()}</span></button><button className="chat-list-delete" type="button" onClick={() => onDelete(thread)} disabled={disabled} aria-label={`Delete ${thread.title}`}><Icon name="trash" size={14} /></button></div>)}</div>
  </aside>;
}

function errorForUi(error: RuntimeError | null): ReactNode {
  if (!error) return null;
  return <div className={`runtime-alert ${error.code === "aborted" ? "muted" : "error"}`} role="status"><span>{error.message}</span></div>;
}

function ignoreRpc(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

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
      const dx = previous.orbRect.left - nextOrbRect.left;
      const dy = previous.orbRect.top - nextOrbRect.top;
      const scale = previous.orbRect.width / Math.max(nextOrbRect.width, 1);
      const animation = orb.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
        { transform: "translate(0px, 0px) scale(1)" },
      ], { duration: 820, easing: "cubic-bezier(.25, 1.3, .4, 1)" });
      animation.onfinish = () => { orb.style.transform = ""; };
      presence.animate([
        { height: `${previous.presenceRect.height}px`, opacity: 1 },
        { height: `${nextPresenceRect.height}px`, opacity: 1 },
      ], { duration: 640, easing: "cubic-bezier(.5, 0, .8, .35)" });
      orbRef.current?.pulse();
    }
    previousRef.current = { docked, orbRect: nextOrbRect, presenceRect: nextPresenceRect };
  }, [animateDock, docked]);

  useEffect(() => {
    if (pulseVersion !== previousPulseRef.current) {
      orbRef.current?.pulse();
      previousPulseRef.current = pulseVersion;
    }
  }, [pulseVersion]);

  return <div ref={presenceRef} className={`orb-presence ${docked ? "orb-presence-docked" : "orb-presence-hero"}`}>
    <div className="orb-frame"><Orb ref={orbRef} state={state} /></div>
    <div className="orb-meta"><span className="orb-state-label">{spec.label}</span><span className="orb-state-desc">{spec.description}</span></div>
  </div>;
}

function useConversationOrbState(snapshot: RuntimeSnapshot): { state: OrbState; pulseVersion: number } {
  const [state, setState] = useState<OrbState>("idle");
  const [pulseVersion, setPulseVersion] = useState(0);
  const previousRef = useRef<{ threadId: string | null; runId: string | null; runStatus: string | null } | null>(null);
  const timersRef = useRef<number[]>([]);
  const transientRef = useRef(false);

  useEffect(() => {
    const previous = previousRef.current;
    const threadChanged = previous !== null && previous.threadId !== snapshot.activeThreadId;
    const clearTimers = () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current = [];
      transientRef.current = false;
    };
    const sequence = (steps: Array<{ state: OrbState; duration: number }>) => {
      clearTimers();
      transientRef.current = true;
      let elapsed = 0;
      setState(steps[0].state);
      steps.slice(1).forEach((step) => {
        elapsed += steps[steps.indexOf(step) - 1].duration;
        timersRef.current.push(window.setTimeout(() => {
          setState(step.state);
          if (step === steps[steps.length - 1]) {
            transientRef.current = false;
            timersRef.current = [];
          }
        }, elapsed));
      });
    };

    if (threadChanged) clearTimers();

    if (snapshot.activeRun?.status === "running") {
      clearTimers();
      setState(snapshot.messages.some((message) => message.status === "streaming") ? "working" : "thinking");
    } else if (!threadChanged && previous?.runStatus === "running" && previous.runId) {
      if (snapshot.error?.code === "aborted" || snapshot.activeRun?.status === "aborted") {
        sequence([{ state: "interrupted", duration: 1400 }, { state: "recovery", duration: 1300 }, { state: "idle", duration: 0 }]);
      } else if (!snapshot.error) {
        setPulseVersion((value) => value + 1);
        sequence([{ state: "done", duration: 1400 }, { state: "idle", duration: 0 }]);
      } else {
        clearTimers();
        setState("recovery");
      }
    } else if (!transientRef.current) {
      if (snapshot.error?.code === "aborted") setState("idle");
      else if (snapshot.error) setState("recovery");
      else setState("idle");
    }

    previousRef.current = {
      threadId: snapshot.activeThreadId,
      runId: snapshot.activeRun?.runId ?? null,
      runStatus: snapshot.activeRun?.status ?? null,
    };
  }, [snapshot]);

  useEffect(() => () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return { state, pulseVersion };
}

function Companion({ snapshot, input, setInput, onSend, onAbort, onSettings, onCreate, onSwitch, onDelete, onOrbState }: { snapshot: RuntimeSnapshot; input: string; setInput: (value: string) => void; onSend: (event: FormEvent<HTMLFormElement>) => void; onAbort: () => void; onSettings: () => void; onCreate: () => void; onSwitch: (threadId: string) => void; onDelete: (thread: ThreadSummary) => void; onOrbState: (state: OrbState) => void }) {
  const running = snapshot.activeRun?.status === "running";
  const selectedModel = snapshot.models.find((model) => model.id === snapshot.selectedModelId);
  const canChat = snapshot.credential.verified && snapshot.activeThreadId !== null && snapshot.status !== "error";
  const { state, pulseVersion } = useConversationOrbState(snapshot);
  const orbRef = useRef<OrbHandle>(null);
  const [dockedThreads, setDockedThreads] = useState<Set<string>>(() => new Set());
  const threadId = snapshot.activeThreadId;

  useEffect(() => {
    onOrbState(state);
  }, [onOrbState, state]);

  useEffect(() => {
    if (!threadId || (!snapshot.messages.length && !snapshot.activeRun)) return;
    setDockedThreads((current) => {
      if (current.has(threadId)) return current;
      const next = new Set(current);
      next.add(threadId);
      return next;
    });
  }, [snapshot.activeRun, snapshot.messages.length, threadId]);

  const docked = !!threadId && (snapshot.messages.length > 0 || !!snapshot.activeRun || dockedThreads.has(threadId));
  const animateDock = !!threadId && running && !dockedThreads.has(threadId);

  return <section className="view active"><div className="text-chat-layout">
    <ThreadList snapshot={snapshot} disabled={running} onCreate={onCreate} onSwitch={onSwitch} onDelete={onDelete} />
    <div className="stage">
      <OrbPresence state={state} docked={docked} animateDock={animateDock} pulseVersion={pulseVersion} orbRef={orbRef} />
      <div className="thread" aria-live="polite">{snapshot.messages.map((message) => <MessageView key={message.id} message={message} />)}{errorForUi(snapshot.error)}</div>
      <div className="chat-context-row"><span>{selectedModel?.name ?? snapshot.selectedModelId}</span><span>via OpenRouter</span><span className={`runtime-dot ${snapshot.credential.verified ? "ok" : "off"}`} />{snapshot.credential.verified ? "Connected" : <button className="btn-tertiary" type="button" onClick={onSettings}>Connect a key</button>}</div>
      {running ? <div className="composer composer-running"><span className="composer-running-label">PROTEUS is responding…</span><button className="stop-btn" type="button" onClick={onAbort}><Icon name="stop" size={14} /> Stop</button></div> : <form className={`composer${canChat ? "" : " disabled"}`} onSubmit={onSend} autoComplete="off"><input className="composer-input" value={input} onChange={(event) => { setInput(event.target.value); orbRef.current?.nudge(); }} placeholder={canChat ? "Message PROTEUS…" : "Connect OpenRouter in Settings to chat"} aria-label="Message PROTEUS" disabled={!canChat} maxLength={32_000} /><button className="send-btn" type="submit" aria-label="Send" disabled={!canChat || !input.trim()}><Icon name="send" size={18} /></button></form>}
    </div>
  </div></section>;
}

function MessageView({ message }: { message: ChatMessage }) {
  if (message.role === "user") return <div className="msg user"><div className="bubble">{message.text}</div></div>;
  return <div className="msg ai"><div className="msg-avatar" aria-hidden="true" /><div className="msg-body"><div className="msg-text">{message.text}{message.status === "streaming" && <span className="stream-caret" aria-label="Streaming">▍</span>}{message.status === "interrupted" && <span className="message-status">Stopped</span>}{message.status === "error" && <span className="message-status">Response failed</span>}</div></div></div>;
}

function Settings({ snapshot, apiKey, setApiKey, onConnect, onDisconnect, onRefresh, onSelectModel }: { snapshot: RuntimeSnapshot; apiKey: string; setApiKey: (value: string) => void; onConnect: (event: FormEvent<HTMLFormElement>) => void; onDisconnect: () => void; onRefresh: () => void; onSelectModel: (modelId: OpenRouterModel["id"]) => void }) {
  const selected = snapshot.models.find((model) => model.id === snapshot.selectedModelId);
  const price = (value: number | undefined) => value === undefined ? "—" : `$${(value * 1_000_000).toFixed(2)}/M`;
  return <section className="view active"><div className="page-narrow"><PageHeader kicker="Yours to control" title="Settings" subtitle="One provider, one secure key, and a live OpenRouter text-model catalog." />
    <section className="card settings-card"><h2 className="title-md">OpenRouter connection</h2><p className="settings-intro">Your key is checked before it is stored securely on this device.</p><form className="key-form" onSubmit={onConnect}><Icon name="key" size={18} /><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={snapshot.credential.configured ? "Enter a replacement key" : "sk-or-v1-…"} autoComplete="off" aria-label="OpenRouter API key" /><button className="btn-primary sm" type="submit" disabled={!apiKey.trim() || snapshot.status === "validating-key"}>{snapshot.status === "validating-key" ? "Checking…" : snapshot.credential.configured ? "Replace key" : "Connect key"}</button></form><div className="connection-status"><span className={`runtime-dot ${snapshot.credential.verified ? "ok" : "off"}`} />{snapshot.credential.verified ? "Verified with OpenRouter" : snapshot.credential.configured ? "Key saved but not verified" : "No key connected"}{snapshot.credential.configured && <button className="btn-danger-ghost" type="button" onClick={onDisconnect}>Disconnect</button>}</div>{errorForUi(snapshot.error)}</section>
    <section className="card settings-card"><div className="settings-section-head"><div><h2 className="title-md">Text model</h2><p className="settings-intro">Choose the text model used for new conversations.</p></div><button className="btn-outline sm" type="button" onClick={onRefresh} disabled={!snapshot.credential.verified || snapshot.status === "loading-models"}><Icon name="refresh" size={15} /> Refresh</button></div><div className="model-picker"><label htmlFor="model-select">Selected model</label><select id="model-select" className="settings-select model-select" value={snapshot.selectedModelId} onChange={(event) => onSelectModel(event.target.value as OpenRouterModel["id"])} disabled={!snapshot.credential.verified || snapshot.activeRun !== null}>{snapshot.models.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.id}</option>)}</select></div>{selected && <div className="model-meta"><span>{selected.contextLength ? `${selected.contextLength.toLocaleString()} token context` : "OpenRouter-managed context"}</span><span>Prompt {price(selected.promptPrice)}</span><span>Completion {price(selected.completionPrice)}</span></div>}</section>
  </div></section>;
}

function Projects() { return <section className="view active"><div className="page-narrow"><PageHeader kicker="Your contexts" title="Projects" subtitle="Keep longer-running work organized around the conversations that matter." /><div className="card"><p>Projects will be available here when you are ready to organize longer-running work.</p></div></div></section>; }
function Memory() { return <section className="view active"><div className="page-narrow"><PageHeader kicker="Conversation history" title="Memory" subtitle="Conversation history stays on this device. You decide what should be kept for later." /><div className="card"><p>Long-term memory is not enabled yet. Your conversation history remains available in its chat.</p></div></div></section>; }

export default function App() {
  const [view, setView] = useState<View>("companion");
  const [collapsed, setCollapsed] = useState(false);
  const [input, setInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(DEFAULT_SNAPSHOT);

  useEffect(() => {
    const onChanged = (next: RuntimeSnapshot) => setSnapshot(next);
    rpc.addMessageListener("runtime.changed", onChanged);
    void rpc.request["runtime.bootstrap"]().then(setSnapshot).catch(() => setSnapshot((current) => ({ ...current, status: "offline", error: { code: "offline", message: "The desktop runtime is not reachable.", retryable: true } })));
    return () => rpc.removeMessageListener("runtime.changed", onChanged);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && snapshot.activeRun?.status === "running") ignoreRpc(rpc.request["chat.abort"]());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [snapshot.activeRun]);

  useEffect(() => {
    if (view !== "companion") setOrbState("idle");
  }, [view]);

  const activeTitle = useMemo(() => snapshot.threads.find((thread) => thread.id === snapshot.activeThreadId)?.title ?? "New chat", [snapshot.threads, snapshot.activeThreadId]);
  const handleSend = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    ignoreRpc(rpc.request["chat.send"]({ text }).then((result) => { if (result.accepted) setInput(""); }));
  };
  const handleConnect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = apiKey;
    setApiKey("");
    ignoreRpc(rpc.request["credentials.connect"]({ apiKey: candidate }));
  };
  const handleCreate = () => { ignoreRpc(rpc.request["threads.create"]({ title: "New chat" })); };
  const handleDelete = (thread: ThreadSummary) => { if (window.confirm(`Delete “${thread.title}”? This cannot be undone.`)) ignoreRpc(rpc.request["threads.delete"]({ threadId: thread.id })); };
  const handleRename = () => { const next = window.prompt("Conversation name", activeTitle); if (next?.trim()) ignoreRpc(rpc.request["threads.rename"]({ title: next })); };

  return <><div className="ambient" aria-hidden="true"><div className="ambient-orb amb-mint" /><div className="ambient-orb amb-lavender" /><div className="ambient-orb amb-sky" /></div><div className="app-shell"><Sidebar view={view} collapsed={collapsed} orbState={orbState} onView={setView} onToggle={() => setCollapsed((value) => !value)} /><main>
    {view === "companion" && <><div className="chat-titlebar window-drag-region electrobun-webkit-app-region-drag"><div><p className="caption-uppercase">Active conversation</p><h1 className="chat-title">{activeTitle}</h1></div>{snapshot.activeThreadId && <button className="btn-outline sm electrobun-webkit-app-region-no-drag" type="button" onClick={handleRename} disabled={snapshot.activeRun !== null}><Icon name="edit" size={15} /> Rename</button>}</div><Companion snapshot={snapshot} input={input} setInput={setInput} onSend={handleSend} onAbort={() => ignoreRpc(rpc.request["chat.abort"]())} onSettings={() => setView("settings")} onCreate={handleCreate} onSwitch={(threadId) => ignoreRpc(rpc.request["threads.switch"]({ threadId }))} onDelete={handleDelete} onOrbState={setOrbState} /></>}
    {view === "projects" && <Projects />}{view === "memory" && <Memory />}{view === "settings" && <Settings snapshot={snapshot} apiKey={apiKey} setApiKey={setApiKey} onConnect={handleConnect} onDisconnect={() => ignoreRpc(rpc.request["credentials.disconnect"]())} onRefresh={() => ignoreRpc(rpc.request["models.refresh"]())} onSelectModel={(modelId) => ignoreRpc(rpc.request["models.select"]({ modelId }))} />}
  </main></div></>;
}
