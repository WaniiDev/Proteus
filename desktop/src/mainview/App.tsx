import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { DEFAULT_MODEL_ID } from "../shared/constants";
import type { ChatMessage, MemoryScope, OrbState, RuntimeSnapshot, RuntimeSnapshotEnvelope, ThreadSummary, WorkspaceBinding } from "../shared/contracts";
import { rpc } from "./lib/bridge";
import { useScrollbars } from "./ds-app/useScrollbars";
import { useViewSwap } from "./ds-app/useViewSwap";
import { Lens } from "./components/Lens";
import { createRuntimeSnapshotTransport } from "./lib/runtime-snapshot-transport";
import { reconcileQueuedDrafts, type QueuedDraft } from "./lib/composer-ui";
import { Sidebar, type View } from "./components/Sidebar";
import { DeleteThreadModal } from "./components/DeleteThreadModal";
import { Companion } from "./views/Companion";
import { ProjectsView } from "./views/ProjectsView";
import { SettingsView, type SettingsSection } from "./views/SettingsView";

const DEFAULT_SNAPSHOT: RuntimeSnapshot = {
  revision: 0,
  status: "booting",
  credential: { configured: false, verified: false },
  providerAuth: null,
  providers: [
    { id: "openrouter", name: "OpenRouter", configured: false, verified: false, availability: "needs-configuration" },
    { id: "codex", name: "Codex", configured: false, verified: false, availability: "needs-configuration" },
  ],
  models: [
    {
      id: DEFAULT_MODEL_ID,
      providerId: "openrouter",
      rawId: "auto",
      name: "Auto Router",
      inputModalities: ["text"],
      outputModalities: ["text"],
    },
  ],
  selectedProviderId: "openrouter",
  selectedModelId: DEFAULT_MODEL_ID,
  selectedReasoningEffort: null,
  projects: [],
  activeWorkspace: { binding: { kind: "app" }, label: "Proteus workspace", availability: "ready" },
  threads: [],
  activeThreadId: null,
  retryMessageId: null,
  messages: [],
  events: [],
  interactions: [],
  workbench: {
    status: "idle",
    tasks: [],
    pendingInteractions: [],
    queuedFollowUpCount: 0,
    tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  },
  activeRun: null,
  continuation: null,
  error: null,
};

function ignoreRpc(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

export default function App() {
  useScrollbars();
  const [view, setView] = useState<View>("companion");
  const { shown: shownView, leaving: viewLeaving } = useViewSwap(view);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("providers");
  const [settingsMemoryScope, setSettingsMemoryScope] = useState<MemoryScope | undefined>();
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const remembered = localStorage.getItem("proteus.ui.nav-collapsed");
    if (remembered !== null) return remembered !== "true";
    return window.innerWidth >= 1100;
  });
  const [input, setInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [, setOrbState] = useState<OrbState>("idle");
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(DEFAULT_SNAPSHOT);
  useEffect(() => {
    localStorage.setItem("proteus.ui.nav-collapsed", String(!sidebarOpen));
  }, [sidebarOpen]);
  const [localMessages, setLocalMessages] = useState<Map<string, ChatMessage>>(() => new Map());
  const [queuedDrafts, setQueuedDrafts] = useState<QueuedDraft[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<ThreadSummary | null>(null);
  const [creatingChat, setCreatingChat] = useState(false);
  const creatingChatRef = useRef(false);
  const [newChatError, setNewChatError] = useState<string | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);
  const transportRetryRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const transport = createRuntimeSnapshotTransport({
      fetchBootstrap: () => rpc.request["runtime.bootstrap"](),
      reportDecodeFailure: (report) => {
        void rpc.request["diagnostics.report-runtime-snapshot-decode"](report).catch(() => undefined);
      },
      onSnapshot: setSnapshot,
      onTransportError: setTransportError,
      onRuntimeUnavailable: (hasValidSnapshot) => {
        if (hasValidSnapshot) {
          setTransportError("The desktop runtime could not be reached. Your last valid conversation state is still visible.");
          return;
        }
        setSnapshot((current) => ({
          ...current,
          status: "offline",
          error: {
            code: "offline",
            message: "The desktop runtime is not reachable.",
            retryable: true,
          },
        }));
      },
    });
    const onChanged = (next: RuntimeSnapshotEnvelope) => transport.accept(next, "runtime.changed");
    rpc.addMessageListener("runtime.changed", onChanged);
    transportRetryRef.current = () => void transport.requestBootstrap("manual");
    void transport.requestBootstrap("initial");
    return () => {
      transport.dispose();
      transportRetryRef.current = () => undefined;
      rpc.removeMessageListener("runtime.changed", onChanged);
    };
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
  const handleConnect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = apiKey;
    setApiKey("");
    ignoreRpc(rpc.request["providers.connect"]({ providerId: "openrouter", mode: "api-key", apiKey: candidate }));
  };
  const createChat = async (workspaceBinding: WorkspaceBinding, workspaceLabel: string, availability: "ready" | "missing") => {
    if (snapshot.activeRun || creatingChatRef.current) return;
    if (availability !== "ready") {
      setNewChatError(`Reconnect ${workspaceLabel} in Projects before starting another chat.`);
      return;
    }
    creatingChatRef.current = true;
    setCreatingChat(true);
    setNewChatError(null);
    try {
      const result = await rpc.request["threads.create"]({ title: "New chat", workspaceBinding });
      if (!result.threadId) {
        setNewChatError(workspaceBinding.kind === "project" ? `Reconnect ${workspaceLabel} in Projects before starting another chat.` : "The new chat could not be created. Try again.");
        return;
      }
      setView("companion");
    } catch {
      setNewChatError("The new chat could not be created. Try again.");
    } finally {
      creatingChatRef.current = false;
      setCreatingChat(false);
    }
  };
  const handleCreate = () => {
    const workspace = snapshot.activeWorkspace;
    void createChat(workspace.binding, workspace.label, workspace.availability);
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
  const handleCreateProjectChat = (projectId: string) => {
    const project = snapshot.projects.find((item) => item.id === projectId);
    void createChat({ kind: "project", projectId }, project?.name ?? "this project", project?.availability ?? "missing");
  };
  const handleSelectProjectThread = (threadId: string) => {
    void rpc.request["threads.select"]({ threadId }).then((result) => {
      if (result.accepted) setView("companion");
    });
  };
  const handleOpenProjectMemory = (projectId: string) => {
    setSettingsMemoryScope({ kind: "project", projectId });
    setSettingsSection("memory");
    setView("settings");
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
      <div className="app-shell">
        <div className="ambient" aria-hidden="true"><i /><i /><i /></div>
        <Sidebar view={view} settingsSection={settingsSection} disabled={snapshot.activeRun !== null || creatingChat} onView={handleNavigate} onMemory={() => { setSettingsMemoryScope(undefined); setSettingsSection("memory"); setView("settings"); }} onSettings={() => { if (settingsSection === "memory") { setSettingsMemoryScope(undefined); setSettingsSection("providers"); } setView("settings"); }} onCreate={handleCreate} threads={snapshot.threads} activeThreadId={snapshot.activeThreadId} messages={snapshot.messages} onSwitch={(threadId) => ignoreRpc(rpc.request["threads.select"]({ threadId }))} onRename={handleRename} onPin={(threadId, pinned) => ignoreRpc(rpc.request["threads.pin"]({ threadId, pinned }))} onDeleteRequest={setDeleteTarget} />
        {sidebarOpen && <button type="button" className="app-nav-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />}
        <main className="app-stage">
          <div className={viewLeaving ? "view is-leaving" : "view"}>
          {shownView === "companion" && (
            <Companion
              snapshot={renderedSnapshot}
              activeTitle={activeTitle}
              input={input}
              setInput={setInput}
              queuedDrafts={queuedDrafts.filter((draft) => draft.threadId === renderedSnapshot.activeThreadId)}
              transportError={transportError}
              onTransportRetry={() => transportRetryRef.current()}
              onSend={handleSend}
              onAbort={() => ignoreRpc(rpc.request["chat.abort"]())}
              onSettings={() => handleNavigate("settings")} onProviders={() => { setSettingsMemoryScope(undefined); setSettingsSection("providers"); handleNavigate("settings"); }} onModels={() => { setSettingsMemoryScope(undefined); setSettingsSection("models"); handleNavigate("settings"); }} onProjects={() => handleNavigate("projects")}
              onOrbState={setOrbState}
              onRetry={(messageId) => ignoreRpc(rpc.request["chat.retry"]({ messageId }))}
              onContinue={(messageId) => ignoreRpc(rpc.request["chat.continue"]({ messageId }))}
              onInteraction={(toolCallId, response) => rpc.request["chat.interaction.respond"]({ toolCallId, response })}
              onInteractionDismiss={(toolCallId) => rpc.request["chat.interaction.dismiss"]({ toolCallId })}
              onToolApproval={(toolCallId, approved, fingerprint) =>
                rpc.request["chat.tool-approval.respond"]({ toolCallId, approved, fingerprint })
                  .catch(() => ({ accepted: false, code: "resume-failed", message: "The tool decision could not be sent.", retryable: true }))
              }
            />
          )}
          {shownView === "projects" && <ProjectsView snapshot={snapshot} onCreateChat={handleCreateProjectChat} onSelectThread={handleSelectProjectThread} onOpenMemory={handleOpenProjectMemory} />}
          {shownView === "settings" && <SettingsView snapshot={snapshot} section={settingsSection} onSection={(section) => { setSettingsSection(section); if (section !== "memory") setSettingsMemoryScope(undefined); }} memoryScope={settingsMemoryScope} apiKey={apiKey} setApiKey={setApiKey} onConnect={handleConnect} onDisconnect={(providerId) => ignoreRpc(rpc.request["providers.disconnect"]({ providerId }))} onStartCodexAuth={(mode) => ignoreRpc(rpc.request["providers.connect"]({ providerId: "codex", mode }))} onSubmitCodexAuth={(value) => ignoreRpc(rpc.request["providers.auth.submit"]({ providerId: "codex", value }))} onCancelCodexAuth={() => ignoreRpc(rpc.request["providers.auth.cancel"]({ providerId: "codex" }))} onRefresh={() => ignoreRpc(rpc.request["models.refresh"]())} onSelectProvider={(providerId) => ignoreRpc(rpc.request["providers.select"]({ providerId }))} onSelectModel={(modelId) => ignoreRpc(rpc.request["models.select"]({ modelId }))} onSelectReasoning={(reasoningEffort) => ignoreRpc(rpc.request["models.reasoning.select"]({ reasoningEffort }))} />}
          </div>
        </main>
      </div>
      <Lens />
      {newChatError && <div className="app-shell-notice" role="alert"><span>{newChatError}</span><button type="button" onClick={() => setNewChatError(null)} aria-label="Dismiss new chat error"><X size={14} /></button></div>}
      {deleteTarget && <DeleteThreadModal thread={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={handleDeleteConfirm} />}
    </>
  );
}