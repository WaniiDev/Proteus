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

export const connectionRouteSchema = z.enum(["openai-subscription", "openrouter-api"]);
export type ConnectionRoute = z.infer<typeof connectionRouteSchema>;

export const voicePathSchema = z.enum(["gemini-live", "google-cascade"]);
export type VoicePath = z.infer<typeof voicePathSchema>;

export const thinkingLevelSchema = z.enum(["auto", "off", "low", "medium", "high", "xhigh"]);
export type ThinkingLevel = z.infer<typeof thinkingLevelSchema>;

export const modelSelectionSchema = z.object({
  route: connectionRouteSchema,
  provider: z.string().min(1),
  model: z.string().min(1),
  thinking: thinkingLevelSchema,
});
export type ModelSelection = z.infer<typeof modelSelectionSchema>;

export const proteusCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message.send"), text: z.string().min(1), conversationId: z.string() }),
  z.object({ type: z.literal("run.interrupt"), conversationId: z.string() }),
  z.object({ type: z.literal("mode.change"), mode: z.enum(["voice", "chat"]) }),
  z.object({ type: z.literal("model.select"), selection: modelSelectionSchema }),
]);
export type ProteusCommand = z.infer<typeof proteusCommandSchema>;

export const proteusEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("orb.state"), state: orbStateSchema, description: z.string().optional() }),
  z.object({ type: z.literal("message.append"), role: z.enum(["user", "assistant", "system"]), text: z.string() }),
  z.object({ type: z.literal("session.status"), status: z.enum(["ready", "connecting", "recovery", "offline"]) }),
  z.object({ type: z.literal("provider.status"), route: connectionRouteSchema, connected: z.boolean() }),
]);
export type ProteusEvent = z.infer<typeof proteusEventSchema>;
