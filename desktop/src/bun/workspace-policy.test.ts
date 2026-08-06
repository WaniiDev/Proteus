import { describe, expect, test } from "bun:test";
import { resolveToolConfig, WORKSPACE_TOOLS } from "@mastra/core/workspace";
import { FILE_WORKSPACE_TOOLS } from "./workspace-policy";

describe("native Mastra workspace policy", () => {
  test("allows inspection but gates mutations and rejects newly-added tools", async () => {
    const context = { workspace: {}, requestContext: {} };
    expect(await resolveToolConfig(FILE_WORKSPACE_TOOLS, WORKSPACE_TOOLS.FILESYSTEM.READ_FILE, context)).toMatchObject({ enabled: true, requireApproval: false });
    expect(await resolveToolConfig(FILE_WORKSPACE_TOOLS, WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE, context)).toMatchObject({ enabled: true, requireApproval: true, requireReadBeforeWrite: true });
    expect(await resolveToolConfig(FILE_WORKSPACE_TOOLS, WORKSPACE_TOOLS.FILESYSTEM.DELETE, context)).toMatchObject({ enabled: true, requireApproval: true });
    expect(await resolveToolConfig(FILE_WORKSPACE_TOOLS, WORKSPACE_TOOLS.FILESYSTEM.AST_EDIT, context)).toMatchObject({ enabled: false });
    expect(await resolveToolConfig(FILE_WORKSPACE_TOOLS, WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND, context)).toMatchObject({ enabled: false });
  });
});
