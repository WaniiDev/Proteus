import { z } from "zod";

export const orbStates = ["idle", "summoned", "away", "listening", "thinking", "working", "remembering", "drafting", "verifying", "waiting", "speaking", "done", "interrupted", "error", "recovery"] as const;
export const orbStateSchema = z.enum(orbStates);
export type OrbState = z.infer<typeof orbStateSchema>;

export const runtimeStatusSchema = z.enum(["booting", "needs-key", "validating-key", "loading-models", "ready", "running", "offline", "error"]);
export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>;

export const credentialStatusSchema = z.object({
  configured: z.boolean(),
  verified: z.boolean(),
});
export type CredentialStatus = z.infer<typeof credentialStatusSchema>;

export const providerIds = ["openrouter", "codex"] as const;
export const providerIdSchema = z.enum(providerIds);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const reasoningEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export const reasoningEffortSchema = z.enum(reasoningEfforts);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export const providerStatusSchema = z.object({
  id: providerIdSchema,
  name: z.string().min(1),
  configured: z.boolean(),
  verified: z.boolean(),
  availability: z.enum(["ready", "needs-configuration", "checking", "unavailable"]),
  detail: z.string().optional(),
});
export type ProviderStatus = z.infer<typeof providerStatusSchema>;

export const providerAuthSchema = z.object({
  providerId: providerIdSchema,
  mode: z.enum(["api-key", "browser", "device"]),
  status: z.enum(["starting", "waiting", "completing", "failed"]),
  url: z.string().url().optional(),
  code: z.string().min(1).optional(),
  instructions: z.string().optional(),
  error: z.string().optional(),
});
export type ProviderAuth = z.infer<typeof providerAuthSchema>;

export const providerErrorCodeSchema = z.enum(["invalid-credential", "insufficient-credits", "forbidden", "model-unavailable", "context-too-large", "rate-limited", "timeout", "offline", "aborted", "busy", "secure-store-unavailable", "catalog-unavailable", "unknown"]);
export type ProviderErrorCode = z.infer<typeof providerErrorCodeSchema>;

export const runtimeErrorSchema = z.object({
  code: providerErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
});
export type RuntimeError = z.infer<typeof runtimeErrorSchema>;

export type OpenRouterModelId = `openrouter/${string}`;
export const openRouterModelIdSchema = z.string().regex(/^openrouter\/.+$/, "Model must be routed through OpenRouter") as z.ZodType<OpenRouterModelId>;
export type CodexModelId = `codex/${string}`;
export type ProviderModelId = `${ProviderId}/${string}`;
export const providerModelIdSchema = z.string().regex(/^(?:openrouter|codex)\/.+$/, "Model must belong to a supported provider") as z.ZodType<ProviderModelId>;

export const providerModelSchema = z.object({
  id: providerModelIdSchema,
  providerId: providerIdSchema,
  rawId: z.string().min(1),
  name: z.string().min(1),
  baseModelId: z.string().min(1).optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
  reasoningOptions: z.array(reasoningEffortSchema).optional(),
  contextLength: z.number().int().positive().optional(),
  promptPrice: z.number().nonnegative().optional(),
  completionPrice: z.number().nonnegative().optional(),
  inputModalities: z.array(z.string()).default(["text"]),
  outputModalities: z.array(z.string()).default(["text"]),
  description: z.string().optional(),
});
export type ProviderModel = z.infer<typeof providerModelSchema>;

export const openRouterModelSchema = providerModelSchema.extend({
  id: openRouterModelIdSchema,
  providerId: z.literal("openrouter"),
});
export type OpenRouterModel = z.infer<typeof openRouterModelSchema>;

export const chatTextPartSchema = z.object({
  type: z.literal("text"),
  id: z.string().min(1),
  text: z.string(),
});

export const toolActivityStatusSchema = z.enum(["streaming_input", "running", "waiting", "completed", "error", "cancelled", "declined"]);
export const chatToolPartSchema = z.object({
  type: z.literal("tool"),
  id: z.string().min(1),
  toolCallId: z.string().min(1),
  name: z.string().min(1),
  label: z.string().min(1),
  status: toolActivityStatusSchema,
  inputSummary: z.string().optional(),
  outputSummary: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
});
export const chatMessagePartSchema = z.discriminatedUnion("type", [chatTextPartSchema, chatToolPartSchema]);
export type ChatMessagePart = z.infer<typeof chatMessagePartSchema>;
export type ChatToolPart = z.infer<typeof chatToolPartSchema>;

export const chatMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  status: z.enum(["complete", "streaming", "interrupted", "error"]),
  createdAt: z.string(),
  turnId: z.string().min(1),
  parts: z.array(chatMessagePartSchema),
  attempt: z.number().int().positive().optional(),
  retryable: z.boolean().optional(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["steer", "system"]),
  text: z.string(),
  createdAt: z.string(),
});
export type ChatEvent = z.infer<typeof chatEventSchema>;

export const taskStatusSchema = z.enum(["pending", "in_progress", "completed"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const workbenchTaskSchema = z.object({
  id: z.string().min(1),
  content: z.string(),
  activeForm: z.string(),
  status: taskStatusSchema,
});
export type WorkbenchTask = z.infer<typeof workbenchTaskSchema>;

export const interactionKindSchema = z.enum(["ask_user", "submit_plan", "tool_approval"]);
export type InteractionKind = z.infer<typeof interactionKindSchema>;

export const interactionStatusSchema = z.enum(["pending", "resolving", "approved", "rejected", "answered", "cancelled", "failed"]);
export type InteractionStatus = z.infer<typeof interactionStatusSchema>;

export const interactionErrorSchema = z.object({
  code: z.enum(["invalid-response", "stale", "busy", "resume-denied", "resume-failed"]),
  message: z.string().min(1),
  retryable: z.boolean(),
});
export type InteractionError = z.infer<typeof interactionErrorSchema>;

export type InteractionResponseResult =
  | { accepted: true }
  | { accepted: false; code: InteractionError["code"]; message: string; retryable: boolean };

export const planVersionSchema = z.object({
  version: z.number().int().positive(),
  title: z.string(),
  summary: z.string(),
  steps: z.array(z.string()),
  raw: z.string().optional(),
  sourcePath: z.string().optional(),
  status: z.enum(["draft", "approved", "rejected"]),
  feedback: z.string().optional(),
});
export type PlanVersion = z.infer<typeof planVersionSchema>;

export const pendingInteractionSchema = z.object({
  id: z.string().min(1),
  toolCallId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  kind: interactionKindSchema,
  title: z.string(),
  toolName: z.string().min(1).optional(),
  args: z.unknown().optional(),
  argsSummary: z.string().optional(),
  fingerprint: z.string().min(1).optional(),
  policyVersion: z.number().int().positive().optional(),
  question: z.string().optional(),
  options: z
    .array(
      z.object({
        label: z.string(),
        description: z.string().optional(),
      }),
    )
    .default([]),
  selectionMode: z.enum(["single_select", "multi_select"]).optional(),
  plan: planVersionSchema.optional(),
  status: interactionStatusSchema,
  originMessageId: z.string().min(1).optional(),
  error: interactionErrorSchema.optional(),
  createdAt: z.string(),
});
export type PendingInteraction = z.infer<typeof pendingInteractionSchema>;

export const tokenUsageSchema = z.object({
  promptTokens: z.number().nonnegative().default(0),
  completionTokens: z.number().nonnegative().default(0),
  totalTokens: z.number().nonnegative().default(0),
  reasoningTokens: z.number().nonnegative().optional(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const workbenchStatusSchema = z.enum(["idle", "active", "waiting", "complete", "interrupted", "error"]);
export type WorkbenchStatus = z.infer<typeof workbenchStatusSchema>;

export const workbenchSchema = z.object({
  status: workbenchStatusSchema,
  goal: z.string().optional(),
  tasks: z.array(workbenchTaskSchema),
  pendingInteractions: z.array(pendingInteractionSchema),
  queuedFollowUpCount: z.number().int().nonnegative(),
  tokenUsage: tokenUsageSchema,
});
export type WorkbenchState = z.infer<typeof workbenchSchema>;

export const threadSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  activity: z.enum(["idle", "running", "waiting", "complete", "interrupted", "error"]).default("idle"),
  attention: z.number().int().nonnegative().default(0),
});
export type ThreadSummary = z.infer<typeof threadSummarySchema>;

export const activeRunSchema = z.object({
  runId: z.string().min(1),
  threadId: z.string().min(1),
  status: z.enum(["running", "aborted", "error", "complete"]),
});
export type ActiveRun = z.infer<typeof activeRunSchema>;

export const diagnosticSourceSchema = z.enum(["mastra", "runtime", "rpc", "storage"]);
export type DiagnosticSource = z.infer<typeof diagnosticSourceSchema>;

export const diagnosticEntrySchema = z.object({
  sequence: z.number().int().nonnegative(),
  timestamp: z.string(),
  source: diagnosticSourceSchema,
  type: z.string().min(1),
  phase: z.string().optional(),
  threadId: z.string().optional(),
  runId: z.string().optional(),
  toolCallId: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  payload: z.unknown().optional(),
});
export type DiagnosticEntry = z.infer<typeof diagnosticEntrySchema>;

export const diagnosticsSnapshotSchema = z.object({
  enabled: z.boolean(),
  filePath: z.string(),
  entries: z.array(diagnosticEntrySchema),
});
export type DiagnosticsSnapshot = z.infer<typeof diagnosticsSnapshotSchema>;

export const runtimeSnapshotSchema = z.object({
  revision: z.number().int().nonnegative().default(0),
  status: runtimeStatusSchema,
  credential: credentialStatusSchema,
  providerAuth: providerAuthSchema.nullable().default(null),
  providers: z.array(providerStatusSchema),
  models: z.array(providerModelSchema),
  selectedProviderId: providerIdSchema,
  selectedModelId: providerModelIdSchema,
  selectedReasoningEffort: reasoningEffortSchema.nullable(),
  threads: z.array(threadSummarySchema),
  activeThreadId: z.string().nullable(),
  retryMessageId: z.string().min(1).nullable().default(null),
  messages: z.array(chatMessageSchema),
  events: z.array(chatEventSchema),
  interactions: z.array(pendingInteractionSchema),
  workbench: workbenchSchema,
  activeRun: activeRunSchema.nullable(),
  error: runtimeErrorSchema.nullable(),
});
export type RuntimeSnapshot = z.infer<typeof runtimeSnapshotSchema>;

/**
 * Runtime snapshots cross Electrobun's native JavaScript-evaluation fallback.
 * Keep the outer packet ASCII-only and carry the original UTF-8 JSON in Base64.
 */
export const runtimeSnapshotEnvelopeSchema = z
  .object({
    version: z.literal(1),
    encoding: z.literal("utf8-base64-json"),
    data: z
      .string()
      .min(1)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, "Runtime snapshot envelope data must be standard Base64"),
  })
  .strict();
export type RuntimeSnapshotEnvelope = z.infer<typeof runtimeSnapshotEnvelopeSchema>;

export const proteusRpcSchema = {
  bun: {
    requests: {
      "runtime.bootstrap": {
        params: undefined as undefined,
        response: {} as RuntimeSnapshotEnvelope,
      },
      "providers.connect": {
        params: {} as { providerId: ProviderId; mode?: "api-key" | "browser" | "device"; apiKey?: string },
        response: {} as { accepted: boolean },
      },
      "providers.disconnect": {
        params: {} as { providerId: ProviderId },
        response: {} as { accepted: boolean },
      },
      "providers.auth.submit": {
        params: {} as { providerId: ProviderId; value: string },
        response: {} as { accepted: boolean },
      },
      "providers.auth.cancel": {
        params: {} as { providerId: ProviderId },
        response: {} as { accepted: boolean },
      },
      "models.refresh": {
        params: undefined as undefined,
        response: {} as { accepted: boolean },
      },
      "models.select": {
        params: {} as { modelId: ProviderModelId },
        response: {} as { accepted: boolean },
      },
      "providers.select": {
        params: {} as { providerId: ProviderId },
        response: {} as { accepted: boolean },
      },
      "models.reasoning.select": {
        params: {} as { reasoningEffort: ReasoningEffort | null },
        response: {} as { accepted: boolean },
      },
      "threads.create": {
        params: {} as { title?: string } | undefined,
        response: {} as { threadId: string },
      },
      "threads.switch": {
        params: {} as { threadId: string },
        response: {} as { accepted: boolean },
      },
      "threads.select": {
        params: {} as { threadId: string },
        response: {} as { accepted: boolean },
      },
      "threads.rename": {
        params: {} as { threadId: string; title: string },
        response: {} as { accepted: boolean },
      },
      "threads.delete": {
        params: {} as { threadId: string },
        response: {} as { accepted: boolean },
      },
      "chat.send": {
        params: {} as { text: string; clientMessageId: string },
        response: {} as { accepted: boolean; runId: string },
      },
      "chat.retry": {
        params: {} as { messageId: string },
        response: {} as { accepted: boolean; runId: string },
      },
      "chat.continue": {
        params: {} as { messageId: string },
        response: {} as { accepted: boolean; runId: string },
      },
      "chat.interaction.respond": {
        params: {} as { toolCallId: string; response: unknown },
        response: {} as InteractionResponseResult,
      },
      "chat.interaction.dismiss": {
        params: {} as { toolCallId: string },
        response: {} as InteractionResponseResult,
      },
      "chat.tool-approval.respond": {
        params: {} as { toolCallId: string; approved: boolean },
        response: {} as { accepted: boolean },
      },
      "chat.abort": {
        params: undefined as undefined,
        response: {} as { accepted: boolean },
      },
      "diagnostics.get": {
        params: {} as { limit?: number } | undefined,
        response: {} as DiagnosticsSnapshot,
      },
      "diagnostics.set-enabled": {
        params: {} as { enabled: boolean },
        response: {} as DiagnosticsSnapshot,
      },
      "diagnostics.clear": {
        params: undefined as undefined,
        response: {} as DiagnosticsSnapshot,
      },
      "diagnostics.export": {
        params: undefined as undefined,
        response: {} as { path: string },
      },
    },
    messages: {},
  },
  webview: {
    requests: {},
    messages: {
      "runtime.changed": {} as RuntimeSnapshotEnvelope,
    },
  },
} as const;

export type ProteusRPCSchema = typeof proteusRpcSchema;
