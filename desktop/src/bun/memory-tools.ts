import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { memoryCategorySchema, memoryEntrySchema, type MemoryScope } from "../shared/contracts";
import type { ScopedMemoryManager } from "./scoped-memory";

const agentMemoryScopeSchema = z.enum(["global", "current_project"]);

export function createMemoryTools(manager: ScopedMemoryManager) {
  const remember = createTool({
    id: "remember",
    description: "Save or update one explicit, durable user preference, profile fact, work style, goal, project context, or decision. Never save credentials, secrets, or temporary conversation details.",
    strict: true,
    inputSchema: z.object({
      scope: agentMemoryScopeSchema.describe("Use current_project only for facts specific to the attached project"),
      category: memoryCategorySchema,
      content: z.string().trim().min(1).max(500),
      entryId: z.string().min(1).max(200).optional().describe("Existing memory entry ID when correcting a saved memory"),
    }),
    outputSchema: z.object({ ok: z.literal(true), entry: memoryEntrySchema }),
    mcp: { annotations: { title: "Remember", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    execute: async ({ scope, category, content, entryId }, context) => {
      const resolved = resolveAgentScope(scope, context?.requestContext);
      const label = resolveScopeLabel(resolved, context?.requestContext);
      const entry = entryId
        ? await manager.update(resolved, entryId, category, content, label)
        : await manager.create(resolved, category, content, label);
      return { ok: true as const, entry };
    },
  });

  const forgetMemory = createTool({
    id: "forget_memory",
    description: "Delete one specific saved Proteus memory by its entry ID. This is destructive and always requires the user's approval.",
    strict: true,
    requireApproval: true,
    inputSchema: z.object({
      scope: agentMemoryScopeSchema,
      entryId: z.string().min(1).max(200),
    }),
    outputSchema: z.object({ ok: z.literal(true), deletedEntryId: z.string() }),
    mcp: { annotations: { title: "Forget memory", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
    execute: async ({ scope, entryId }, context) => {
      const resolved = resolveAgentScope(scope, context?.requestContext);
      await manager.delete(resolved, entryId, resolveScopeLabel(resolved, context?.requestContext));
      return { ok: true as const, deletedEntryId: entryId };
    },
  });

  return { remember, forget_memory: forgetMemory };
}

function resolveAgentScope(scope: "global" | "current_project", requestContext: { get(key: string): unknown } | undefined): MemoryScope {
  if (scope === "global") return { kind: "global" };
  const projectId = requestContext?.get("proteus-project-id");
  if (typeof projectId !== "string" || !projectId) throw new Error("Current-project memory requires a chat attached to a project");
  return { kind: "project", projectId };
}

function resolveScopeLabel(scope: MemoryScope, requestContext: { get(key: string): unknown } | undefined): string {
  if (scope.kind === "global") return "All conversations";
  const label = requestContext?.get("proteus-project-label");
  return typeof label === "string" && label.trim() ? label.trim() : "Current project";
}
