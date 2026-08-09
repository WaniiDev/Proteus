import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mastra/core/agent";
import { LocalFilesystem, LocalSandbox, Workspace, WORKSPACE_TOOLS } from "@mastra/core/workspace";
import { RequestContext } from "@mastra/core/request-context";
import { createCompatibleWorkspaceTools } from "./workspace-tool-compat";
import { scriptedStreamingModel } from "./native-mastra-test-harness";

describe("effective Agent workspace command catalog", () => {
  test("has one authoritative repaired native command tool", async () => {
    const root = await mkdtemp(join(tmpdir(), "proteus-agent-workspace-"));
    const workspace = new Workspace({ filesystem: new LocalFilesystem({ basePath: root, contained: true }), sandbox: new LocalSandbox({ workingDirectory: root, isolation: "none" }) });
    const requestContext = new RequestContext();
    const agent = new Agent({ id: "workspace-catalog-test", name: "Workspace catalog", instructions: "test", model: scriptedStreamingModel([]), tools: async () => createCompatibleWorkspaceTools(workspace, requestContext) });
    const tools = await agent.getToolsForExecution({ requestContext });
    const names = Object.keys(tools).filter((name) => name === WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND);
    expect(names).toEqual([WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]);
    const command = tools[WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]!;
    const validator = command.parameters as unknown as { validate: (value: unknown) => unknown };
    expect(await validator.validate({ command: "git status", cwd: ".", tail: "100", timeout: "30" })).toMatchObject({ success: true, value: { tail: 100, timeout: 30 } });
    expect(await validator.validate({ command: "git status", tail: "many" })).toMatchObject({ success: false });
    await workspace.destroy(); await rm(root, { recursive: true, force: true });
  });
});
