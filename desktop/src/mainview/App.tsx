import { useEffect, useRef, useState } from "react";
import type { ConnectionRoute, ModelSelection, OrbState, ThinkingLevel, VoicePath } from "../shared/contracts";

type View = "companion" | "projects" | "memory" | "settings";
type Mode = "voice" | "chat";
type Message = { id: string; role: "user" | "assistant"; text: string };

const orbDescriptions: Record<OrbState, { label: string; description: string }> = {
  idle: { label: "At rest", description: "Speak or type below — English first." },
  listening: { label: "Listening", description: "I’m listening for your next thought." },
  thinking: { label: "Thinking", description: "Working through the request." },
  working: { label: "Working", description: "Making the next step visible." },
  waiting: { label: "Waiting", description: "Waiting for your direction." },
  speaking: { label: "Speaking", description: "You can interrupt at any time." },
  done: { label: "Complete", description: "The response is ready." },
  interrupted: { label: "Interrupted", description: "The run was stopped safely." },
  recovery: { label: "Recovery", description: "Connect a model in Settings to continue." },
};

type IconName = "companion" | "projects" | "memory" | "settings" | "mic" | "chat" | "send" | "stop" | "chevron";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

  switch (name) {
    case "companion":
      return <svg {...common}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></svg>;
    case "projects":
      return <svg {...common}><path d="M3.5 7A2.5 2.5 0 0 1 6 4.5h3l2 2.5h7.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5V7.5" /></svg>;
    case "memory":
      return <svg {...common}><path d="M12 3.5l7.5 4.3v8.4L12 20.5l-7.5-4.3V7.8L12 3.5z" /><circle cx="12" cy="12" r="2.2" /></svg>;
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8" /></svg>;
    case "mic":
      return <svg {...common}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
    case "chat":
      return <svg {...common}><path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" /></svg>;
    case "send":
      return <svg {...common}><path d="M12 19V5M5 12l7-7 7 7" /></svg>;
    case "stop":
      return <svg {...common} fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>;
    case "chevron":
      return <svg {...common}><path d="M15 5l-7 7 7 7" /></svg>;
  }
}

function Orb({ state, withMeta = true }: { state: OrbState; withMeta?: boolean }) {
  const orbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void import("./orb3d.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!orbRef.current) return;
    orbRef.current.dataset.state = state;
    window.orbFX?.setState(state);
  }, [state]);

  const details = orbDescriptions[state];

  return (
    <>
      <div className="orb-float" id="orbFloat" ref={orbRef} data-state={state}>
        <div className="orb-shadow" aria-hidden="true" />
        <canvas className="orb-canvas" id="orbCanvas" />
        <div className="orb-css" id="orbCss">
          <div className="orb-layer l0" />
          <div className="orb-layer l1" />
          <div className="orb-swirl" aria-hidden="true" />
          <div className="orb-sheen" aria-hidden="true" />
        </div>
        <div className="orb-ring r1" aria-hidden="true" />
        <div className="orb-ring r2" aria-hidden="true" />
        <div className="orb-ring r3" aria-hidden="true" />
        <div className="orb-orbit" aria-hidden="true"><i /><i /><i /></div>
      </div>
      {withMeta && <div className="orb-meta">
        <span className="orb-state-label">{details.label}</span>
        <span className="orb-state-desc">{details.description}</span>
      </div>}
    </>
  );
}

function Sidebar({ view, collapsed, onView, onToggle }: { view: View; collapsed: boolean; onView: (view: View) => void; onToggle: () => void }) {
  const links: Array<{ view: View; label: string; icon: IconName }> = [
    { view: "companion", label: "Companion", icon: "companion" },
    { view: "projects", label: "Projects", icon: "projects" },
    { view: "memory", label: "Memory", icon: "memory" },
    { view: "settings", label: "Settings", icon: "settings" },
  ];

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="sb-top">
        <button className="brand" type="button" onClick={() => onView("companion")} aria-label="PROTEUS home">
          <span className="brand-orb" aria-hidden="true" />
          <span className="brand-word sb-label">PROTEUS</span>
        </button>
        <button className="sb-toggle" type="button" onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed}>
          <Icon name="chevron" size={16} />
        </button>
      </div>
      <nav className="sb-menu" aria-label="Primary">
        {links.map((link) => (
          <button className={`sb-link${view === link.view ? " active" : ""}`} type="button" key={link.view} onClick={() => onView(link.view)} aria-current={view === link.view ? "page" : undefined}>
            <Icon name={link.icon} />
            <span className="sb-label">{link.label}</span>
          </button>
        ))}
      </nav>
      <div className="sb-bottom">
        <span className="presence" title="PROTEUS status"><span className="presence-dot" /> <span className="sb-label">At rest</span></span>
      </div>
    </aside>
  );
}

function Workbench() {
  return (
    <aside className="workbench" aria-label="Current work">
      <div className="workbench-empty">
        <div className="wb-empty-orb" aria-hidden="true" />
        <p className="wb-empty-title">Nothing in progress</p>
        <p className="wb-empty-text">When a request involves real work, the goal, steps, evidence, uncertainties, and decisions appear here before anything consequential happens.</p>
      </div>
    </aside>
  );
}

function Companion({ mode, onMode, state, messages, onSubmit, onMic, onStop, input, onInput, runtimeNotice, onSettings }: {
  mode: Mode;
  onMode: (mode: Mode) => void;
  state: OrbState;
  messages: Message[];
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onMic: () => void;
  onStop: () => void;
  input: string;
  onInput: (value: string) => void;
  runtimeNotice: boolean;
  onSettings: () => void;
}) {
  const details = orbDescriptions[state];

  return (
    <section className="view active">
      <div className="companion-grid">
        <div className="stage">
          {messages.length === 0 && !runtimeNotice ? (
            <div className="stage-center">
              <Orb state={state} />
            </div>
          ) : (
            <>
              <div className="dock-row">
                <div className="orb-slot"><Orb state={state} withMeta={false} /></div>
                <div className="dock-meta"><span className="orb-state-label">{details.label}</span><span className="orb-state-desc">{details.description}</span></div>
              </div>
              <div className="thread" aria-live="polite">
                {messages.map((message) => <div className={`msg ${message.role === "user" ? "user" : "ai"}`} key={message.id}><div className="msg-body"><div className={message.role === "user" ? "bubble" : "msg-text"}>{message.text}</div></div></div>)}
                {runtimeNotice && <div className="runtime-notice">The desktop shell is ready. Connect a model in <button className="btn-tertiary" type="button" onClick={onSettings}>Settings</button> to start a real AgentController session.</div>}
              </div>
            </>
          )}

          <div className="mode-bar">
            <div className="mode-seg" role="tablist" aria-label="Interaction mode">
              <button className={`mode-btn${mode === "voice" ? " active" : ""}`} type="button" role="tab" aria-selected={mode === "voice"} onClick={() => onMode("voice")}><Icon name="mic" size={15} />Voice</button>
              <button className={`mode-btn${mode === "chat" ? " active" : ""}`} type="button" role="tab" aria-selected={mode === "chat"} onClick={() => onMode("chat")}><Icon name="chat" size={15} />Chat</button>
            </div>
            <span className="mode-hint">{mode === "voice" ? "Voice is the natural front door — hold the mic and just talk." : "Chat is a complete alternative to voice."}</span>
          </div>

          {mode === "voice" ? (
            <div className="voice-bar">
              <button className="voice-mic" type="button" onClick={onMic} aria-label="Prepare microphone"><Icon name="mic" size={22} /></button>
              <div className="voice-status"><span className="voice-status-text">{state === "listening" ? "Microphone ready — voice connector next." : "Tap the mic and talk — English first."}</span><span className="voice-transcript" /></div>
              <button className="stop-btn voice-stop" type="button" onClick={onStop}><Icon name="stop" size={14} />Stop</button>
            </div>
          ) : (
            <form className="composer" onSubmit={onSubmit} autoComplete="off">
              <button className="mic-btn" type="button" onClick={onMic} aria-label="Prepare microphone"><Icon name="mic" size={18} /></button>
              <input className="composer-input" value={input} onChange={(event) => onInput(event.target.value)} placeholder="Message PROTEUS — English first…" aria-label="Message PROTEUS" />
              <button className="send-btn" type="submit" aria-label="Send"><Icon name="send" size={18} /></button>
            </form>
          )}
          <p className="composer-note">PROTEUS asks before anything consequential. Press Esc to interrupt at any time.</p>
        </div>
        <Workbench />
      </div>
    </section>
  );
}

function PageHeader({ kicker, title, subtitle }: { kicker: string; title: string; subtitle: string }) {
  return <div className="page-head"><p className="caption-uppercase">{kicker}</p><h1 className="display-lg">{title}</h1><p className="page-sub">{subtitle}</p></div>;
}

function Projects() {
  return <section className="view active"><div className="page-narrow"><PageHeader kicker="Your contexts" title="Projects" subtitle="A Project is the story of what you are trying to accomplish — what is known, what changed, what remains open, and where to continue." /><div className="card"><p>No Projects yet. Project continuity will be connected to Mastra sessions in the foundation phase.</p></div></div></section>;
}

function Memory() {
  return <section className="view active"><div className="page-narrow"><PageHeader kicker="You decide what stays" title="Memory" subtitle="PROTEUS remembers only what you choose to keep. Proposed items wait for your review; delete anything at any time." /><div className="memory-cols"><section className="card memory-card"><h2 className="title-md">Proposed — awaiting your review</h2><p className="memory-empty">No memory proposals.</p></section><section className="card memory-card"><h2 className="title-md">Kept by you</h2><p className="memory-empty">No kept memories.</p></section></div></div></section>;
}

function Settings({ route, setRoute, selection, setSelection, voicePath, setVoicePath }: { route: ConnectionRoute; setRoute: (route: ConnectionRoute) => void; selection: ModelSelection; setSelection: (selection: ModelSelection) => void; voicePath: VoicePath; setVoicePath: (path: VoicePath) => void }) {
  return <section className="view active"><div className="page-narrow">
    <PageHeader kicker="Yours to control" title="Settings" subtitle="Provider, Model, and Thinking stay visible and user-controlled. Credentials will be stored in Windows Credential Manager." />
    <section className="card settings-card"><h2 className="title-md">Model connection</h2>
      <div className="setting-row"><div><p className="setting-name">Connection route</p><p className="setting-desc">OpenAI subscription is tested first; OpenRouter remains the API fallback.</p></div><select className="settings-select" value={route} onChange={(event) => { const next = event.target.value as ConnectionRoute; setRoute(next); setSelection({ ...selection, route: next }); }}><option value="openai-subscription">OpenAI subscription</option><option value="openrouter-api">OpenRouter API</option></select></div>
      <div className="setting-row"><div><p className="setting-name">Provider</p><p className="setting-desc">The model provider remains visible without changing PROTEUS identity.</p></div><select className="settings-select" value={selection.provider} onChange={(event) => setSelection({ ...selection, provider: event.target.value })}><option>OpenAI</option><option>Anthropic</option><option>Google</option></select></div>
      <div className="setting-row"><div><p className="setting-name">Model</p><p className="setting-desc">The catalog will be curated and refreshable through the provider layer.</p></div><select className="settings-select" value={selection.model} onChange={(event) => setSelection({ ...selection, model: event.target.value })}><option>openai/gpt-5.6-terra</option><option>anthropic/claude-sonnet-5</option><option>google/gemini-3.6-flash</option></select></div>
      <div className="setting-row"><div><p className="setting-name">Thinking</p><p className="setting-desc">Only levels supported by the selected model will be enabled.</p></div><select className="settings-select" value={selection.thinking} onChange={(event) => setSelection({ ...selection, thinking: event.target.value as ThinkingLevel })}><option value="auto">Auto</option><option value="off">Off</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">Extra high</option></select></div>
      <p className="settings-note">Current route: {selection.provider} · {selection.model} · {selection.thinking} · via {route === "openai-subscription" ? "OpenAI subscription" : "OpenRouter API"}</p>
    </section>
    <section className="card settings-card"><h2 className="title-md">Voice path</h2><div className="setting-row"><div><p className="setting-name">Realtime voice</p><p className="setting-desc">Gemini Live remains behind Mastra and is the primary realtime path.</p></div><span className="badge-pill">Gemini Live</span></div><div className="setting-row"><div><p className="setting-name">Cascaded fallback</p><p className="setting-desc">Google speech recognition → selected model → Google speech synthesis.</p></div><select className="settings-select" value={voicePath} onChange={(event) => setVoicePath(event.target.value as VoicePath)}><option value="gemini-live">Gemini Live</option><option value="google-cascade">Google cascade</option></select></div></section>
    <section className="card settings-card"><h2 className="title-md">Permissions</h2><div className="setting-row"><div><p className="setting-name">Microphone</p><p className="setting-desc">Explicit permission only. PROTEUS is not always-listening.</p></div><span className="badge-pill">Ask first</span></div><div className="setting-row"><div><p className="setting-name">Consequential actions</p><p className="setting-desc">Actions will require explicit approval in the workflow phase.</p></div><span className="badge-pill badge-lock">Always ask</span></div></section>
  </div></section>;
}

export default function App() {
  const [view, setView] = useState<View>("companion");
  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState<Mode>("voice");
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [runtimeNotice, setRuntimeNotice] = useState(false);
  const [route, setRoute] = useState<ConnectionRoute>("openai-subscription");
  const [selection, setSelection] = useState<ModelSelection>({ route: "openai-subscription", provider: "OpenAI", model: "openai/gpt-5.6-terra", thinking: "auto" });
  const [voicePath, setVoicePath] = useState<VoicePath>("gemini-live");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOrbState("interrupted");
        window.setTimeout(() => setOrbState("idle"), 500);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text }]);
    setInput("");
    setOrbState("recovery");
    setRuntimeNotice(true);
  };

  const handleMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setOrbState("listening");
      setRuntimeNotice(true);
    } catch {
      setOrbState("recovery");
      setRuntimeNotice(true);
    }
  };

  const handleStop = () => {
    setOrbState("interrupted");
    window.setTimeout(() => setOrbState("idle"), 500);
  };

  return <><div className="ambient" aria-hidden="true"><div className="ambient-orb amb-mint" /><div className="ambient-orb amb-lavender" /><div className="ambient-orb amb-sky" /></div><div className="app-shell"><Sidebar view={view} collapsed={collapsed} onView={setView} onToggle={() => setCollapsed((value) => !value)} /><main>{view === "companion" && <Companion mode={mode} onMode={setMode} state={orbState} messages={messages} onSubmit={handleSubmit} onMic={() => void handleMic()} onStop={handleStop} input={input} onInput={setInput} runtimeNotice={runtimeNotice} onSettings={() => setView("settings")} />}{view === "projects" && <Projects />}{view === "memory" && <Memory />}{view === "settings" && <Settings route={route} setRoute={setRoute} selection={selection} setSelection={setSelection} voicePath={voicePath} setVoicePath={setVoicePath} />}</main></div></>;
}
