import { z } from "zod";

export const orbStates = [
  "idle",
  "listening",
  "thinking",
  "working",
  "waiting",
  "speaking",
  "done",
  "interrupted",
  "recovery",
] as const;
export const orbStateSchema = z.enum(orbStates);
export type OrbState = z.infer<typeof orbStateSchema>;

export const runtimeStatusSchema = z.enum([
  "booting",
  "needs-key",
  "validating-key",
  "loading-models",
  "ready",
  "running",
  "offline",
  "error",
]);
export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>;

export const credentialStatusSchema = z.object({
  configured: z.boolean(),
  verified: z.boolean(),
});
export type CredentialStatus = z.infer<typeof credentialStatusSchema>;

export const providerErrorCodeSchema = z.enum([
  "invalid-credential",
  "insufficient-credits",
  "forbidden",
  "model-unavailable",
  "context-too-large",
  "rate-limited",
  "timeout",
  "offline",
  "aborted",
  "busy",
  "secure-store-unavailable",
  "catalog-unavailable",
  "unknown",
]);
export type ProviderErrorCode = z.infer<typeof providerErrorCodeSchema>;

export const runtimeErrorSchema = z.object({
  code: providerErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
});
export type RuntimeError = z.infer<typeof runtimeErrorSchema>;

export type OpenRouterModelId = `openrouter/${string}`;
export const openRouterModelIdSchema = z.string().regex(/^openrouter\/.+$/, "Model must be routed through OpenRouter") as z.ZodType<OpenRouterModelId>;

export const openRouterModelSchema = z.object({
  id: openRouterModelIdSchema,
  rawId: z.string().min(1),
  name: z.string().min(1),
  contextLength: z.number().int().positive().optional(),
  promptPrice: z.number().nonnegative().optional(),
  completionPrice: z.number().nonnegative().optional(),
  inputModalities: z.array(z.string()).default(["text"]),
  outputModalities: z.array(z.string()).default(["text"]),
  description: z.string().optional(),
});
export type OpenRouterModel = z.infer<typeof openRouterModelSchema>;

export const chatMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  status: z.enum(["complete", "streaming", "interrupted", "error"]),
  createdAt: z.string(),
  turnId: z.string().optional(),
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

export const interactionKindSchema = z.enum(["ask_user", "submit_plan"]);
export type InteractionKind = z.infer<typeof interactionKindSchema>;

export const interactionStatusSchema = z.enum(["pending", "resolving", "approved", "rejected", "answered", "cancelled"]);
export type InteractionStatus = z.infer<typeof interactionStatusSchema>;

export const planVersionSchema = z.object({
  version: z.number().int().positive(),
  title: z.string(),
  summary: z.string(),
  steps: z.array(z.string()),
  raw: z.string().optional(),
  status: z.enum(["draft", "approved", "rejected"]),
  feedback: z.string().optional(),
});
export type PlanVersion = z.infer<typeof planVersionSchema>;

export const pendingInteractionSchema = z.object({
  id: z.string().min(1),
  toolCallId: z.string().min(1),
  kind: interactionKindSchema,
  title: z.string(),
  question: z.string().optional(),
  options: z.array(z.object({
    label: z.string(),
    description: z.string().optional(),
  })).default([]),
  selectionMode: z.enum(["single_select", "multi_select"]).optional(),
  plan: planVersionSchema.optional(),
  status: interactionStatusSchema,
  createdAt: z.string(),
});
export type PendingInteraction = z.infer<typeof pendingInteractionSchema>;

export const queuedFollowUpSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  createdAt: z.string(),
});
export type QueuedFollowUp = z.infer<typeof queuedFollowUpSchema>;

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
  queuedFollowUps: z.array(queuedFollowUpSchema),
  clearedFollowUps: z.array(queuedFollowUpSchema),
  tokenUsage: tokenUsageSchema,
  activeTools: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
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

export const runtimeSnapshotSchema = z.object({
  status: runtimeStatusSchema,
  credential: credentialStatusSchema,
  models: z.array(openRouterModelSchema),
  selectedModelId: openRouterModelIdSchema,
  threads: z.array(threadSummarySchema),
  activeThreadId: z.string().nullable(),
  messages: z.array(chatMessageSchema),
  events: z.array(chatEventSchema),
  interactions: z.array(pendingInteractionSchema),
  resolvedInteractions: z.array(pendingInteractionSchema),
  workbench: workbenchSchema,
  activeRun: activeRunSchema.nullable(),
  error: runtimeErrorSchema.nullable(),
});
export type RuntimeSnapshot = z.infer<typeof runtimeSnapshotSchema>;

export const proteusRpcSchema = {
  bun: {
    requests: {
      "runtime.bootstrap": { params: undefined as undefined, response: {} as RuntimeSnapshot },
      "credentials.connect": { params: {} as { apiKey: string }, response: {} as { accepted: boolean } },
      "credentials.disconnect": { params: undefined as undefined, response: {} as { accepted: boolean } },
      "models.refresh": { params: undefined as undefined, response: {} as { accepted: boolean } },
      "models.select": { params: {} as { modelId: OpenRouterModelId }, response: {} as { accepted: boolean } },
      "threads.create": { params: {} as { title?: string } | undefined, response: {} as { threadId: string } },
      "threads.switch": { params: {} as { threadId: string }, response: {} as { accepted: boolean } },
      "threads.select": { params: {} as { threadId: string }, response: {} as { accepted: boolean } },
      "threads.rename": { params: {} as { threadId: string; title: string }, response: {} as { accepted: boolean } },
      "threads.delete": { params: {} as { threadId: string }, response: {} as { accepted: boolean } },
      "chat.send": { params: {} as { text: string }, response: {} as { accepted: boolean; runId: string } },
      "chat.steer": { params: {} as { text: string }, response: {} as { accepted: boolean; runId: string } },
      "chat.retry": { params: {} as { messageId: string }, response: {} as { accepted: boolean; runId: string } },
      "chat.continue": { params: {} as { messageId: string }, response: {} as { accepted: boolean; runId: string } },
      "chat.interaction.respond": { params: {} as { toolCallId: string; response: unknown }, response: {} as { accepted: boolean } },
      "chat.queue.update": { params: {} as { id: string; content: string }, response: {} as { accepted: boolean } },
      "chat.queue.remove": { params: {} as { id: string }, response: {} as { accepted: boolean } },
      "chat.queue.restore": { params: {} as { id: string }, response: {} as { accepted: boolean } },
      "chat.abort": { params: undefined as undefined, response: {} as { accepted: boolean } },
    },
    messages: {},
  },
  webview: {
    requests: {},
    messages: {
      "runtime.changed": {} as RuntimeSnapshot,
    },
  },
} as const;

export type ProteusRPCSchema = typeof proteusRpcSchema;
