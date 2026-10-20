import type { ChatMessage, RuntimeError, RuntimeSnapshot, ThreadSummary } from "../../shared/contracts";
import type { AppModelSelection } from "../providers/model-preferences";
import { reconcileProviderAuth } from "../providers/provider-auth";
import { normalizeError } from "../core/runtime-error-mapping";
import type { LiveAssistantProjection, ProjectedToolOutcome } from "../core/runtime-projection";
import { DEFAULT_MODEL_ID } from "../../shared/constants";
import { DEFAULT_PROVIDER_ID } from "./constants";
import { emptyWorkbench } from "./message-mapping";
import type { InteractionResolution, PersistedThreadState, SnapshotListener } from "./types";

/**
 * Owner of the state shared across services: one snapshot, one selection, one thread-state cache
 * and one run marker. State only one service uses (write queues, continuation tracks, plan
 * hydration, Codex auth) is private to that service.
 */
export class RuntimeContext {
  private readonly listeners = new Set<SnapshotListener>();
  private composerMutationQueue: Promise<void> = Promise.resolve();
  /** Wired by TextRuntime: resolves once the runtime finished its first initialization. */
  ensureInitialized: () => Promise<void> = async () => undefined;

  // Selection and per-thread state.
  selectedThreadId: string | null = null;
  threadState: PersistedThreadState = {};
  readonly threadStateCache = new Map<string, PersistedThreadState>();
  readonly threadActivity = new Map<string, { activity: ThreadSummary["activity"]; attention: number }>();
  preferredModelSelection: AppModelSelection | null = null;
  threadSelectionGeneration = 0;
  threadStateSyncGeneration = 0;
  pendingThreadSelectionId: string | null = null;

  // Interactions waiting on Mastra.
  readonly resolvingInteractions = new Map<string, InteractionResolution>();
  readonly nativeSuspensions = new Map<string, { runId: string; threadId: string }>();

  // The one active run and its projection.
  runId: string | null = null;
  runThreadId: string | null = null;
  runOutcome: "streaming" | "complete" | "interrupted" | "error" = "complete";
  runError: RuntimeError | null = null;
  lastAssistantId: string | null = null;
  runClientMessageId: string | null = null;
  startingRun = false;
  startingRunId: string | null = null;
  startingRunAbortRequested = false;
  retryingText: string | null = null;
  hideSingleRetry = false;
  readonly assistantProjections = new Map<string, LiveAssistantProjection>();
  readonly persistedAssistantIds = new Map<string, Set<string>>();
  readonly optimisticUserMessages = new Map<string, { threadId: string; message: ChatMessage }>();
  readonly runToolOutcomes = new Map<string, ProjectedToolOutcome>();

  snapshot: RuntimeSnapshot = {
    status: "booting",
    credential: { configured: false, verified: false },
    providerAuth: null,
    providers: [
      { id: "openrouter", name: "OpenRouter", configured: false, verified: false, availability: "needs-configuration" },
      { id: "codex", name: "Codex", configured: false, verified: false, availability: "needs-configuration", detail: "Connect a ChatGPT subscription to use Codex." },
      { id: "anthropic", name: "Anthropic", configured: false, verified: false, availability: "needs-configuration", detail: "Add an Anthropic API key to use Claude models." },
    ],
    models: [
      {
        id: DEFAULT_MODEL_ID,
        providerId: "openrouter",
        rawId: "auto",
        name: "Auto Router",
        description: "Let OpenRouter choose a suitable text model for each request.",
        inputModalities: ["text"],
        outputModalities: ["text"],
      },
    ],
    selectedProviderId: DEFAULT_PROVIDER_ID,
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
    workbench: emptyWorkbench(),
    activeRun: null,
    continuation: null,
    error: null,
    revision: 0,
  };

  onSnapshot(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): RuntimeSnapshot {
    return structuredClone(this.snapshot);
  }

  reportError(error: unknown): void {
    const normalized = error && typeof error === "object" && "code" in error && "message" in error ? (error as RuntimeError) : normalizeError(error);
    this.publish({ error: normalized });
  }

  publish(next: Partial<RuntimeSnapshot>): void {
    const providers = next.credential
      ? this.snapshot.providers.map((provider) =>
          provider.id === "openrouter"
            ? {
                ...provider,
                configured: next.credential!.configured,
                verified: next.credential!.verified,
                availability: next.credential!.verified ? "ready" as const : next.credential!.configured ? "checking" as const : "needs-configuration" as const,
              }
            : provider,
        )
      : next.providers;
    const nextProviders = providers ?? this.snapshot.providers;
    const requestedProviderAuth = Object.hasOwn(next, "providerAuth") ? next.providerAuth ?? null : this.snapshot.providerAuth;
    this.snapshot = {
      ...this.snapshot,
      ...next,
      ...(providers ? { providers } : {}),
      providerAuth: reconcileProviderAuth(nextProviders, requestedProviderAuth),
      revision: this.snapshot.revision + 1,
    };
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  idleStatus(providerId = this.snapshot.selectedProviderId): RuntimeSnapshot["status"] {
    if (providerId !== "openrouter") return this.snapshot.providers.find((provider) => provider.id === providerId)?.availability === "ready" ? "ready" : "error";
    return this.snapshot.credential.verified ? "ready" : "needs-key";
  }

  /** Clear the shared run marker, but only when it still belongs to this run. */
  releaseRun(runId: string): void {
    if (this.runId !== runId) return;
    this.runId = null;
    this.runThreadId = null;
  }

  enqueueComposerMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.composerMutationQueue.catch(() => undefined).then(operation);
    this.composerMutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}
