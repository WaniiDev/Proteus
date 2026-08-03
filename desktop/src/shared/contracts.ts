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
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const threadSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ThreadSummary = z.infer<typeof threadSummarySchema>;

export const activeRunSchema = z.object({
  runId: z.string().min(1),
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
      "threads.rename": { params: {} as { title: string }, response: {} as { accepted: boolean } },
      "threads.delete": { params: {} as { threadId: string }, response: {} as { accepted: boolean } },
      "chat.send": { params: {} as { text: string }, response: {} as { accepted: boolean; runId: string } },
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
