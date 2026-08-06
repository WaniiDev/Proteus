import { createWorkspaceTools, WORKSPACE_TOOLS, type Workspace } from "@mastra/core/workspace";
import type { RequestContext } from "@mastra/core/request-context";
import { z } from "zod";

type WorkspaceToolWithZodInput = {
  inputSchema?: z.ZodObject<Record<string, z.ZodType>>;
};

function numericStringToNumber(value: unknown): unknown {
  if (typeof value !== "string" || value.trim() === "") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

/**
 * Keep Mastra's native workspace tools and execution path, while normalizing a
 * known schema inconsistency in @mastra/core 1.56.0: execute_command.timeout
 * accepts numeric strings but execute_command.tail does not.
 */
export async function createCompatibleWorkspaceTools(
  workspace: Workspace,
  requestContext: RequestContext<any>,
) {
  const tools = await createWorkspaceTools(workspace, { workspace, requestContext });
  const commandTool = tools[WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND] as WorkspaceToolWithZodInput | undefined;
  const schema = commandTool?.inputSchema;
  const tailSchema = schema?.shape.tail;
  if (commandTool && schema && tailSchema) {
    commandTool.inputSchema = schema.extend({ tail: z.preprocess(numericStringToNumber, tailSchema) });
  }
  return tools;
}

