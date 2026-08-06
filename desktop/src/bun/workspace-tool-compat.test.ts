import { describe, expect, test } from "bun:test";
import { LocalFilesystem, LocalSandbox, Workspace, WORKSPACE_TOOLS } from "@mastra/core/workspace";
import { RequestContext } from "@mastra/core/request-context";
import { createCompatibleWorkspaceTools } from "./workspace-tool-compat";

describe("workspace tool compatibility", () => {
  test("coerces numeric execute_command fields emitted as JSON strings", async () => {
    const workspace = new Workspace({
      filesystem: new LocalFilesystem({ basePath: process.cwd(), contained: true }),
      sandbox: new LocalSandbox({ workingDirectory: process.cwd(), isolation: "none" }),
    });
    const tools = await createCompatibleWorkspaceTools(workspace, new RequestContext());
    const command = tools[WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND];

    expect(command.inputSchema.safeParse({ command: "git status", tail: "100", timeout: "30" })).toMatchObject({
      success: true,
      data: { command: "git status", tail: 100, timeout: 30 },
    });
    await workspace.destroy();
  });
});

