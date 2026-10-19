import { loginOpenAICodex } from "@mastra/code-sdk/auth/providers/openai-codex";
import { Utils } from "electrobun/bun";
import type { ProviderId, ProviderModelId, ReasoningEffort, RuntimeSnapshot } from "../../shared/contracts";
import { type CodexCredentialStore, type CredentialVault } from "../providers/credentials";
import { listOpenRouterTextModels, validateOpenRouterKey } from "../providers/openrouter";
import { selectedModelMissingFromCatalog } from "../providers/provider-readiness";
import { createProteusCodexCatalogProvider, DEFAULT_CODEX_REASONING, listProteusCodexModels } from "../providers/codex-models";
import { describeCodexOAuthFailure, type CodexOAuthFailureStage } from "../providers/codex-oauth-failure";
import { type AppModelSelection, type ModelPreferencesStorage } from "../providers/model-preferences";
import { DEFAULT_MODEL_ID } from "./constants";
import { makeRuntimeError, normalizeError } from "../core/runtime-error-mapping";
import type { RuntimeContext } from "./context";
import type { ThreadService } from "./thread-service";

/** Provider auth, credential validation, model catalog, and model and reasoning selection. */
export class ProviderService {
  readonly modelUsage = new Map<ProviderModelId, { useCount: number; lastUsedAt: string }>();
  codexAuthAbortController: AbortController | null = null;
  codexManualInput: { resolve: (value: string) => void; reject: (error: Error) => void } | null = null;
  private readonly vault: CredentialVault;
  private readonly codexCredentialStore: CodexCredentialStore;
  private readonly codexCatalogProvider: ReturnType<typeof createProteusCodexCatalogProvider>;
  private readonly modelPreferences: ModelPreferencesStorage;
  private readonly threads: ThreadService;
  private readonly abortRun: () => void;

  constructor(private readonly ctx: RuntimeContext, deps: { vault: CredentialVault; codexCredentialStore: CodexCredentialStore; codexCatalogProvider: ReturnType<typeof createProteusCodexCatalogProvider>; modelPreferences: ModelPreferencesStorage; threads: ThreadService; abortRun: () => void }) {
    this.vault = deps.vault;
    this.codexCredentialStore = deps.codexCredentialStore;
    this.codexCatalogProvider = deps.codexCatalogProvider;
    this.modelPreferences = deps.modelPreferences;
    this.threads = deps.threads;
    this.abortRun = deps.abortRun;
  }

  private mergeProviderModels(providerId: ProviderId, models: RuntimeSnapshot["models"]): RuntimeSnapshot["models"] {
    return this.decorateModelsWithUsage([
      ...this.ctx.snapshot.models.filter((model) => model.providerId !== providerId),
      ...models,
    ]);
  }

  private decorateModelsWithUsage(models: RuntimeSnapshot["models"]): RuntimeSnapshot["models"] {
    return models.map((model) => {
      const usage = this.modelUsage.get(model.id);
      return usage ? { ...model, ...usage } : model;
    });
  }

  async refreshCodexModels(): Promise<void> {
    const credential = this.codexCredentialStore.get("openai-codex");
    if (!credential) {
      this.ctx.publish({
        models: this.mergeProviderModels("codex", []),
        providers: this.ctx.snapshot.providers.map((provider) => provider.id === "codex" ? { ...provider, configured: false, verified: false, availability: "needs-configuration", detail: "Connect a ChatGPT subscription to use Codex." } : provider),
      });
      return;
    }
    this.ctx.publish({ providers: this.ctx.snapshot.providers.map((provider) => provider.id === "codex" ? { ...provider, availability: "checking" } : provider) });
    try {
      const models = await listProteusCodexModels(this.codexCatalogProvider);
      if (models.length === 0) throw new Error("The upstream MastraCode catalog did not return any GPT-5 Codex models.");
      this.ctx.publish({
        models: this.mergeProviderModels("codex", models),
        providers: this.ctx.snapshot.providers.map((provider) => provider.id === "codex" ? { ...provider, configured: true, verified: true, availability: "ready", detail: "Connected with ChatGPT OAuth." } : provider),
      });
    } catch (error) {
      this.ctx.publish({
        providers: this.ctx.snapshot.providers.map((provider) => provider.id === "codex" ? { ...provider, configured: true, verified: false, availability: "unavailable", detail: error instanceof Error ? error.message : "Codex is unavailable." } : provider),
      });
    }
  }

  async validateStoredCredential(): Promise<void> {
    const apiKey = await this.vault.get();
    if (!apiKey) {
      this.ctx.publish({
        status: this.ctx.idleStatus(),
        credential: { configured: false, verified: false },
      });
      return;
    }

    this.ctx.publish({
      status: "validating-key",
      credential: { configured: true, verified: false },
      error: null,
    });
    try {
      await validateOpenRouterKey(apiKey);
      this.ctx.publish({
        credential: { configured: true, verified: true },
        status: "loading-models",
      });
      try {
        const models = await listOpenRouterTextModels(apiKey);
        this.ctx.publish({ models: this.mergeProviderModels("openrouter", models), status: "ready", error: null });
        await this.threads.syncThreadState({ clearError: false });
        if (this.ctx.snapshot.selectedModelId !== DEFAULT_MODEL_ID && selectedModelMissingFromCatalog(this.ctx.snapshot.selectedProviderId, this.ctx.snapshot.selectedModelId, "openrouter", models)) {
          this.ctx.publish({
            status: "error",
            error: makeRuntimeError("model-unavailable"),
          });
        }
      } catch {
        this.ctx.publish({
          status: "ready",
          error: makeRuntimeError("catalog-unavailable"),
        });
        await this.threads.syncThreadState({ clearError: false });
      }
    } catch (error) {
      const normalized = normalizeError(error);
      const transient = normalized.code === "offline" || normalized.code === "timeout" || normalized.code === "rate-limited";
      const codexSelected = this.ctx.snapshot.selectedProviderId === "codex";
      this.ctx.publish({
        status: codexSelected ? this.ctx.idleStatus("codex") : transient ? "offline" : normalized.code === "secure-store-unavailable" ? "error" : "needs-key",
        credential: { configured: true, verified: false },
        error: codexSelected ? null : transient || normalized.code === "secure-store-unavailable" ? normalized : makeRuntimeError("invalid-credential"),
      });
    }
  }

  async connectProvider(providerId: ProviderId, options: { apiKey?: string; mode?: "api-key" | "browser" | "device" }): Promise<void> {
    if (providerId === "openrouter") {
      await this.connect(options.apiKey ?? "");
      return;
    }
    await this.ctx.ensureInitialized();
    if (this.ctx.startingRun || this.ctx.runId) throw makeRuntimeError("busy");
    if (this.codexAuthAbortController) throw makeRuntimeError("busy");

    const mode = options.mode === "device" ? "device" : "browser";
    const abortController = new AbortController();
    this.codexAuthAbortController = abortController;
    let resolveManual!: (value: string) => void;
    let rejectManual!: (error: Error) => void;
    const manualInput = new Promise<string>((resolve, reject) => {
      resolveManual = resolve;
      rejectManual = reject;
    });
    const manualHandle = mode === "browser" ? { resolve: resolveManual, reject: rejectManual } : null;
    this.codexManualInput = manualHandle;
    // A cancelled login rejects this promise; nothing may be left to await it.
    manualInput.catch(() => undefined);
    this.ctx.publish({
      providerAuth: { providerId: "codex", mode, status: "starting", instructions: "Starting secure ChatGPT authorization…" },
      error: null,
    });

    let failureStage: CodexOAuthFailureStage = "authorization";
    void loginOpenAICodex({
      mode,
      signal: abortController.signal,
      onAuth: ({ url, instructions }) => {
        if (this.codexAuthAbortController !== abortController) return;
        const code = mode === "device" ? instructions?.match(/Enter code:\s*(\S+)/i)?.[1] : undefined;
        this.ctx.publish({ providerAuth: { providerId: "codex", mode, status: "waiting", url, ...(code ? { code } : {}), ...(instructions ? { instructions } : {}) } });
        try {
          Utils.openExternal(url);
        } catch {
          // The URL remains visible for manual opening when the OS rejects launch.
        }
      },
      onProgress: (instructions) => {
        if (this.codexAuthAbortController !== abortController) return;
        const current = this.ctx.snapshot.providerAuth;
        if (current?.providerId === "codex") this.ctx.publish({ providerAuth: { ...current, instructions } });
      },
      onPrompt: async () => manualInput,
      ...(mode === "browser" ? { onManualCodeInput: async () => manualInput } : {}),
    }).then(async (credentials) => {
      if (abortController.signal.aborted || this.codexAuthAbortController !== abortController) return;
      this.ctx.publish({ providerAuth: { providerId: "codex", mode, status: "completing", instructions: "Saving the authorization securely…" } });
      failureStage = "persistence";
      this.codexCredentialStore.setOAuth(credentials);
      await this.refreshCodexModels();
      if (this.codexAuthAbortController !== abortController) return;
      this.ctx.publish({ providerAuth: null, error: null, status: this.ctx.idleStatus() });
    }).catch((error) => {
      if (this.codexAuthAbortController !== abortController) return;
      if (abortController.signal.aborted) {
        this.ctx.publish({ providerAuth: null });
        return;
      }
      const failure = describeCodexOAuthFailure(error, failureStage);
      this.ctx.publish({
        providerAuth: {
          providerId: "codex",
          mode,
          status: "failed",
          error: failure.message,
        },
      });
      console.warn("Codex OAuth failed", { stage: failureStage, code: failure.code });
    }).finally(() => {
      if (this.codexAuthAbortController === abortController) this.codexAuthAbortController = null;
      // A newer login may already own the manual-input handle after a cancel.
      if (this.codexManualInput === manualHandle) this.codexManualInput = null;
    });
  }

  async submitProviderAuth(providerId: ProviderId, value: string): Promise<void> {
    if (providerId !== "codex" || !this.codexManualInput || this.ctx.snapshot.providerAuth?.status !== "waiting") throw makeRuntimeError("busy");
    const candidate = value.trim();
    if (!candidate) throw new Error("Authorization code cannot be empty");
    this.codexManualInput.resolve(candidate);
    this.codexManualInput = null;
    const current = this.ctx.snapshot.providerAuth;
    this.ctx.publish({ providerAuth: current ? { ...current, status: "completing", instructions: "Completing ChatGPT authorization…" } : null });
  }

  async cancelProviderAuth(providerId: ProviderId): Promise<void> {
    if (providerId !== "codex") return;
    const abortController = this.codexAuthAbortController;
    this.codexAuthAbortController = null;
    abortController?.abort();
    this.codexManualInput?.reject(new Error("Login cancelled"));
    this.codexManualInput = null;
    this.ctx.publish({ providerAuth: null });
  }

  async disconnectProvider(providerId: ProviderId): Promise<void> {
    if (providerId === "openrouter") {
      await this.disconnect();
      return;
    }
    await this.ctx.ensureInitialized();
    if (this.ctx.startingRun || this.ctx.runId) throw makeRuntimeError("busy");
    await this.cancelProviderAuth("codex");
    this.codexCredentialStore.clear();
    this.ctx.publish({
      models: this.mergeProviderModels("codex", []),
      providers: this.ctx.snapshot.providers.map((provider) => provider.id === "codex" ? { ...provider, configured: false, verified: false, availability: "needs-configuration", detail: "Connect a ChatGPT subscription to use Codex." } : provider),
      status: this.ctx.snapshot.selectedProviderId === "codex" ? "error" : this.ctx.idleStatus("openrouter"),
      error: null,
    });
  }

  async connect(apiKey: string): Promise<void> {
    await this.ctx.ensureInitialized();
    const candidate = apiKey.trim();
    if (!candidate) throw new Error("OpenRouter API key cannot be empty");
    if (this.ctx.startingRun) throw makeRuntimeError("busy");
    if (this.ctx.runId) this.abortRun();
    const previousCredential = this.ctx.snapshot.credential;
    this.ctx.publish({ status: "validating-key", error: null });
    try {
      await validateOpenRouterKey(candidate);
      await this.vault.set(candidate);
      this.ctx.publish({
        credential: { configured: true, verified: true },
        status: "loading-models",
        error: null,
      });
      let catalogUnavailable = false;
      try {
        const models = await listOpenRouterTextModels(candidate);
        this.ctx.publish({ models: this.mergeProviderModels("openrouter", models), status: "ready", error: null });
      } catch {
        catalogUnavailable = true;
        this.ctx.publish({
          status: "ready",
          error: makeRuntimeError("catalog-unavailable"),
        });
      }
      await this.threads.syncThreadState({ clearError: !catalogUnavailable });
    } catch (error) {
      const normalized = normalizeError(error);
      const transient = normalized.code === "offline" || normalized.code === "timeout" || normalized.code === "rate-limited";
      this.ctx.publish({
        status: transient ? (previousCredential.verified ? "ready" : "offline") : normalized.code === "secure-store-unavailable" ? "error" : previousCredential.verified ? "ready" : "needs-key",
        credential: previousCredential,
        error: normalized,
      });
      throw normalized;
    }
  }

  async disconnect(): Promise<void> {
    await this.ctx.ensureInitialized();
    if (this.ctx.startingRun) throw makeRuntimeError("busy");
    if (this.ctx.runId) this.abortRun();
    await this.vault.delete();
    this.ctx.publish({
      status: "needs-key",
      credential: { configured: false, verified: false },
      error: null,
    });
  }

  async refreshModels(): Promise<void> {
    await this.ctx.ensureInitialized();
    if (this.ctx.startingRun || this.ctx.runId) throw makeRuntimeError("busy");
    await this.refreshCodexModels();
    const apiKey = await this.vault.get();
    if (!apiKey || !this.ctx.snapshot.credential.verified) {
      return;
    }
    this.ctx.publish({ status: "loading-models", error: null });
    try {
      const models = await listOpenRouterTextModels(apiKey);
      this.ctx.publish({ models: this.mergeProviderModels("openrouter", models), status: "ready", error: null });
      if (this.ctx.snapshot.selectedModelId !== DEFAULT_MODEL_ID && selectedModelMissingFromCatalog(this.ctx.snapshot.selectedProviderId, this.ctx.snapshot.selectedModelId, "openrouter", models)) {
        this.ctx.publish({
          status: "error",
          error: makeRuntimeError("model-unavailable"),
        });
      }
    } catch (error) {
      this.ctx.publish({
        status: "ready",
        error: makeRuntimeError("catalog-unavailable"),
      });
      throw error;
    }
  }

  async selectProvider(providerId: ProviderId): Promise<void> {
    return this.ctx.enqueueComposerMutation(async () => {
      await this.ctx.ensureInitialized();
      if (this.ctx.startingRun || this.ctx.runId) throw makeRuntimeError("busy");
      const model = this.ctx.snapshot.models.find((candidate) => candidate.providerId === providerId);
      if (!model) throw makeRuntimeError("model-unavailable");
      await this.selectModelNow(model.id);
    });
  }

  private async selectModelNow(modelId: ProviderModelId): Promise<void> {
    await this.ctx.ensureInitialized();
    if (this.ctx.startingRun || this.ctx.runId) throw makeRuntimeError("busy");
    const model = this.ctx.snapshot.models.find((candidate) => candidate.id === modelId);
    if (!model) throw makeRuntimeError("model-unavailable");
    const selectedReasoningEffort = model.providerId === "codex"
      ? (model.reasoningOptions?.includes(this.ctx.snapshot.selectedReasoningEffort as ReasoningEffort) ? this.ctx.snapshot.selectedReasoningEffort! : DEFAULT_CODEX_REASONING)
      : model.reasoningEffort ?? null;
    await this.persistModelSelection({
      providerId: model.providerId,
      modelId,
      ...(selectedReasoningEffort ? { reasoningEffort: selectedReasoningEffort } : {}),
    });
    const usage = await this.modelPreferences.recordUsage({
      providerId: model.providerId,
      modelId,
      ...(selectedReasoningEffort ? { reasoningEffort: selectedReasoningEffort } : {}),
    });
    this.modelUsage.set(modelId, { useCount: usage.useCount, lastUsedAt: usage.lastUsedAt });
    this.ctx.publish({
      models: this.decorateModelsWithUsage(this.ctx.snapshot.models),
      selectedProviderId: model.providerId,
      selectedModelId: modelId,
      selectedReasoningEffort,
      status: this.ctx.idleStatus(model.providerId),
      error: null,
    });
  }

  private async persistModelSelection(selection: AppModelSelection): Promise<void> {
    await this.modelPreferences.save(selection);
    this.ctx.preferredModelSelection = selection;
    if (!this.ctx.selectedThreadId) return;
    this.ctx.threadState = { ...this.ctx.threadState, modelSelection: selection };
    await this.threads.persistThreadState(this.ctx.selectedThreadId);
  }

  async selectModel(modelId: ProviderModelId): Promise<void> {
    return this.ctx.enqueueComposerMutation(() => this.selectModelNow(modelId));
  }

  async selectReasoning(reasoningEffort: ReasoningEffort | null): Promise<void> {
    return this.ctx.enqueueComposerMutation(async () => {
      await this.ctx.ensureInitialized();
      if (this.ctx.startingRun || this.ctx.runId) throw makeRuntimeError("busy");
      const selected = this.ctx.snapshot.models.find((model) => model.id === this.ctx.snapshot.selectedModelId);
      if (!selected) throw makeRuntimeError("model-unavailable");
      if (reasoningEffort && !selected.reasoningOptions?.includes(reasoningEffort)) throw makeRuntimeError("model-unavailable");
      const nextReasoningEffort = selected.providerId === "codex" ? reasoningEffort ?? DEFAULT_CODEX_REASONING : reasoningEffort;
      await this.persistModelSelection({
        providerId: selected.providerId,
        modelId: selected.id,
        ...(nextReasoningEffort ? { reasoningEffort: nextReasoningEffort } : {}),
      });
      this.ctx.publish({ selectedReasoningEffort: nextReasoningEffort, error: null });
    });
  }

  /** Restore the remembered model selection and per-model usage before the first thread sync. */
  async loadModelPreferences(): Promise<void> {
    const [preferredModelSelection, modelUsage] = await Promise.all([
      this.modelPreferences.load(),
      this.modelPreferences.listUsage(),
    ]);
    this.ctx.preferredModelSelection = preferredModelSelection;
    for (const usage of modelUsage) {
      this.modelUsage.set(usage.modelId, { useCount: usage.useCount, lastUsedAt: usage.lastUsedAt });
    }
    this.ctx.snapshot.models = this.decorateModelsWithUsage(this.ctx.snapshot.models);
  }
}
