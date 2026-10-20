import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { DEFAULT_MODEL_ID } from "../shared/constants";
import type { AnswerIntentResult, ChatMessage, MemoryScope, OrbState, RuntimeSnapshot, RuntimeSnapshotEnvelope, ThreadSummary, WorkspaceBinding } from "../shared/contracts";
import { rpc } from "./lib/bridge";
import { useScrollbars } from "./ds-app/useScrollbars";
import { useViewSwap } from "./ds-app/useViewSwap";
import { Lens } from "./components/Lens";
import { createRuntimeSnapshotTransport } from "./lib/runtime-snapshot-transport";
import { reconcileQueuedDrafts, type QueuedDraft } from "./lib/composer-ui";
import { Sidebar, type View } from "./components/Sidebar";
import { DeleteThreadModal } from "./components/DeleteThreadModal";
import { FilesDialog } from "./components/conversation/FilesDialog";
import { AnswerIntentStateContext, answerIntentKey, type AnswerIntentEvent, type AnswerIntentState } from "./components/answer";
import { Companion } from "./views/Companion";
import { ProjectsView } from "./views/ProjectsView";
import { MemoryView } from "./views/MemoryView";
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

/** Escape stops the run only from inside the Island, and never while an ask or an answer is open (Escape belongs to that surface then). */
export function shouldAbortOnEscape(target: EventTarget | null, surfaceOpen: boolean): boolean {
  if (surfaceOpen) return false;
  return target instanceof Element && target.closest(".island") !== null;
}

function ignoreRpc(promise: Promise<unknown>): void {
  void promise.catch(() => undefined);
}

export default function App() {
  useScrollbars();
  const [view, setView] = useState<View>("companion");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("providers");
  const [memoryScope, setMemoryScope] = useState<MemoryScope | undefined>();
  const [input, setInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [, setOrbState] = useState<OrbState>("idle");
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(DEFAULT_SNAPSHOT);
  const { shown: shownView, leaving: viewLeaving } = useViewSwap(view);
  // One conversation to another is the same two beats around the thread. The first send that creates a conversation (none -> some) is not a swap.
  const { shown: shownThreadId, leaving: threadLeaving } = useViewSwap(snapshot.activeThreadId, { immediate: (from) => from === null });
  const settledSnapshot = useRef(snapshot);
  if (snapshot.activeThreadId === shownThreadId) settledSnapshot.current = snapshot;
  const displaySnapshot = snapshot.activeThreadId === shownThreadId ? snapshot : settledSnapshot.current;
  const [localMessages, setLocalMessages] = useState<Map<string, ChatMessage>>(() => new Map());
  const [queuedDrafts, setQueuedDrafts] = useState<QueuedDraft[]>([]);
  const [intentPending, setIntentPending] = useState<ReadonlySet<string>>(() => new Set());
  const [intentNotes, setIntentNotes] = useState<Record<string, string>>({});
  const intentInFlight = useRef<Set<string>>(new Set());
  const [filesPath, setFilesPath] = useState<string | null>(null);
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
      if (event.defaultPrevented || event.key !== "Escape" || !snapshot.activeRun) return;
      if (shouldAbortOnEscape(event.target, snapshot.interactions.length > 0 || document.querySelector(".island.is-open") !== null)) ignoreRpc(rpc.request["chat.abort"]());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [snapshot.activeRun, snapshot.interactions.length]);
  const activeTitle = useMemo(() => snapshot.threads.find((thread) => thread.id === snapshot.activeThreadId)?.title ?? "New chat", [snapshot.threads, snapshot.activeThreadId]);
  const handleNavigate = (next: View) => {
    setView(next);
  };
  // `fromInput` clears the Island input on send and puts the text back if the send is refused; a follow-up leaves the input alone.
  const sendText = (text: string, fromInput: boolean) => {
    if (!text) return;
    const clientMessageId = crypto.randomUUID();
    // With no conversation yet the runtime creates one on send; the optimistic bubble is dropped once a thread exists.
    const threadId = snapshot.activeThreadId;
    const runningForThread = threadId !== null && snapshot.activeRun?.status === "running" && snapshot.activeRun.threadId === threadId;
    const createdAt = new Date().toISOString();
    if (runningForThread) {
      setQueuedDrafts((current) => [...current, { id: clientMessageId, threadId: threadId as string, text, createdAt, state: "queued" }]);
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
    if (fromInput) setInput("");
    const undo = () => {
      if (runningForThread) setQueuedDrafts((current) => current.filter((draft) => draft.id !== clientMessageId));
      setLocalMessages((current) => {
        const next = new Map(current);
        next.delete(clientMessageId);
        return next;
      });
      if (fromInput) setInput(text);
    };
    void rpc.request["chat.send"]({ text, clientMessageId })
      .then((result) => { if (!result.accepted) undo(); })
      .catch(undo);
  };
  const handleSend = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sendText(input.trim(), true);
  };
  const handleFollowUp = (text: string) => sendText(text.trim(), false);
  // Answer actions (ADR 0003): the runtime owns routing, the allowlist and approval; this only calls the RPC and shows the result.
  // Resolves true when an approve was recorded, so the Island can pulse the orb and send the wave.
  const handleAnswerIntent = async (event: AnswerIntentEvent): Promise<boolean> => {
    const threadId = snapshot.activeThreadId;
    const targetId = event.rowId ?? event.blockId;
    if (!threadId || !targetId) return false;
    const key = answerIntentKey(event.answerId, targetId);
    if (intentInFlight.current.has(key)) return false;
    intentInFlight.current.add(key);
    setIntentPending((current) => new Set(current).add(key));
    setIntentNotes((current) => { if (!(key in current)) return current; const { [key]: _gone, ...rest } = current; return rest; });
    let result: AnswerIntentResult;
    try {
      result = await rpc.request["chat.answer.intent"]({
        threadId,
        answerId: event.answerId,
        ...(event.blockId ? { blockId: event.blockId } : {}),
        ...(event.rowId ? { rowId: event.rowId } : {}),
        intent: event.intent,
        ...(event.value ? { optionId: event.value } : {}),
      });
    } catch {
      result = { accepted: false, code: "failed", message: "That action could not be sent. Try again." };
    } finally {
      intentInFlight.current.delete(key);
      setIntentPending((current) => { const next = new Set(current); next.delete(key); return next; });
    }
    if (!result.accepted) {
      setIntentNotes((current) => ({ ...current, [key]: result.message }));
      return false;
    }
    if (result.open) setFilesPath(result.open.path);
    if (result.draft !== undefined) setInput(result.draft);
    return event.intent === "approve";
  };
  const intentState = useMemo<AnswerIntentState>(() => ({ pending: intentPending, notes: intentNotes }), [intentPending, intentNotes]);
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
    setMemoryScope({ kind: "project", projectId });
    setView("memory");
  };
  const renderedSnapshot = useMemo<RuntimeSnapshot>(() => {
    if (localMessages.size === 0) return snapshot;
    const messages = [...snapshot.messages];
    for (const message of localMessages.values()) if (!messages.some((item) => item.id === message.id)) messages.push(message);
    messages.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return { ...snapshot, messages };
  }, [localMessages, snapshot]);
  // During the exit beat of a conversation swap the old conversation stays on screen, with its own local messages.
  const displayedSnapshot = displaySnapshot === snapshot ? renderedSnapshot : displaySnapshot;
  return (
    <>
      <div className="app-shell">
        <div className="ambient" aria-hidden="true"><i /><i /><i /></div>
        <Sidebar view={view} disabled={snapshot.activeRun !== null || creatingChat} onView={handleNavigate} onMemory={() => { setMemoryScope(undefined); setView("memory"); }} onSettings={() => setView("settings")} onCreate={handleCreate} threads={snapshot.threads} activeThreadId={snapshot.activeThreadId} messages={snapshot.messages} onSwitch={(threadId) => ignoreRpc(rpc.request["threads.select"]({ threadId }))} onRename={handleRename} onPin={(threadId, pinned) => ignoreRpc(rpc.request["threads.pin"]({ threadId, pinned }))} onDeleteRequest={setDeleteTarget} />
        <main className="app-stage">
          <div className={viewLeaving ? "view is-leaving" : "view"}>
          {shownView === "companion" && (
            <AnswerIntentStateContext.Provider value={intentState}>
            <Companion
              snapshot={displayedSnapshot}
              threadLeaving={threadLeaving}
              activeTitle={activeTitle}
              input={input}
              setInput={setInput}
              queuedDrafts={queuedDrafts.filter((draft) => draft.threadId === displayedSnapshot.activeThreadId)}
              transportError={transportError}
              onTransportRetry={() => transportRetryRef.current()}
              onSend={handleSend}
              onAbort={() => ignoreRpc(rpc.request["chat.abort"]())}
              onSettings={() => handleNavigate("settings")} onProviders={() => { setSettingsSection("providers"); handleNavigate("settings"); }} onModels={() => { setSettingsSection("models"); handleNavigate("settings"); }} onProjects={() => handleNavigate("projects")}
              onOrbState={setOrbState}
              onRetry={(messageId) => ignoreRpc(rpc.request["chat.retry"]({ messageId }))}
              onContinue={(messageId) => ignoreRpc(rpc.request["chat.continue"]({ messageId }))}
              onInteraction={(toolCallId, response) => rpc.request["chat.interaction.respond"]({ toolCallId, response })}
              onInteractionDismiss={(toolCallId) => rpc.request["chat.interaction.dismiss"]({ toolCallId })}
              onIntent={handleAnswerIntent}
              onFollowUp={handleFollowUp}
              onRename={handleRename}
              onPin={(threadId, pinned) => ignoreRpc(rpc.request["threads.pin"]({ threadId, pinned }))}
              onDeleteRequest={setDeleteTarget}
              onToolApproval={(toolCallId, approved, fingerprint) =>
                rpc.request["chat.tool-approval.respond"]({ toolCallId, approved, fingerprint })
                  .catch(() => ({ accepted: false, code: "resume-failed", message: "The tool decision could not be sent.", retryable: true }))
              }
            />
            </AnswerIntentStateContext.Provider>
          )}
          {shownView === "projects" && <ProjectsView snapshot={snapshot} onCreateChat={handleCreateProjectChat} onSelectThread={handleSelectProjectThread} onOpenMemory={handleOpenProjectMemory} />}
          {shownView === "memory" && <MemoryView scope={memoryScope} />}
          {shownView === "settings" && <SettingsView snapshot={snapshot} section={settingsSection} onSection={setSettingsSection} apiKey={apiKey} setApiKey={setApiKey} onConnect={handleConnect} onDisconnect={(providerId) => ignoreRpc(rpc.request["providers.disconnect"]({ providerId }))} onStartCodexAuth={(mode) => ignoreRpc(rpc.request["providers.connect"]({ providerId: "codex", mode }))} onSubmitCodexAuth={(value) => ignoreRpc(rpc.request["providers.auth.submit"]({ providerId: "codex", value }))} onCancelCodexAuth={() => ignoreRpc(rpc.request["providers.auth.cancel"]({ providerId: "codex" }))} onRefresh={() => ignoreRpc(rpc.request["models.refresh"]())} onSelectProvider={(providerId) => ignoreRpc(rpc.request["providers.select"]({ providerId }))} onSelectModel={(modelId) => ignoreRpc(rpc.request["models.select"]({ modelId }))} onSelectReasoning={(reasoningEffort) => ignoreRpc(rpc.request["models.reasoning.select"]({ reasoningEffort }))} />}
          </div>
        </main>
      </div>
      <Lens />
      {newChatError && <div className="app-shell-notice" role="alert"><span>{newChatError}</span><button type="button" onClick={() => setNewChatError(null)} aria-label="Dismiss new chat error"><X size={14} /></button></div>}
      {filesPath !== null && <FilesDialog snapshot={snapshot} initialPath={filesPath} onClose={() => setFilesPath(null)} />}
      {deleteTarget && <DeleteThreadModal thread={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={handleDeleteConfirm} />}
    </>
  );
}