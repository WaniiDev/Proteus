import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RequestContext } from "@mastra/core/request-context";
import { WORKSPACE_TOOLS } from "@mastra/core/workspace";
import { WorkspaceRegistry } from "../src/bun/workspace-registry";
import { createCompatibleWorkspaceTools } from "../src/bun/workspace-tool-compat";

test("production workspace services traverse filesystem, search, skills, and native sandbox", async () => {
  const base = await mkdtemp(join(tmpdir(), "proteus-e2e-")); const root = join(base, "fixture"); await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "fixture.ts"), "export const workspaceSymbol = 'mint semantic agent';\n");
  await mkdir(join(root, ".agents", "skills", "fixture-skill"), { recursive: true }); await writeFile(join(root, ".agents", "skills", "fixture-skill", "SKILL.md"), "---\ndescription: E2E fixture skill\n---\n# Fixture\nSearchable skill guidance.\n");
  const registry = new WorkspaceRegistry(join(base, "state"), () => ({ readOnly: false, allowedPaths: [], skillPaths: [".agents/skills"], autoIndexPaths: [], searchMode: "bm25" }));
  try {
    expect((await registry.tree(root, "", 4))[1]?.name ?? (await registry.tree(root, "", 4))[0]?.name).toBeTruthy();
    const opened = await registry.read(root, "src/fixture.ts"); expect(opened.content).toContain("workspaceSymbol");
    const saved = await registry.write(root, "src/fixture.ts", "export const workspaceSymbol = 'lavender agent';\n", opened.version); expect(saved.content).toContain("lavender");
    await registry.index(root, ["src/fixture.ts"]); expect((await registry.search(root, "lavender agent", { mode: "bm25" }))[0]?.id).toBe("src/fixture.ts");
    expect((await registry.skills(root, true))[0]).toMatchObject({ name: "fixture-skill", description: "E2E fixture skill" });
    const workspace = await registry.resolve(root); const tools = await createCompatibleWorkspaceTools(workspace, new RequestContext()); const command = tools[WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND];
    const parsed = command.inputSchema.safeParse({ command: "echo proteus-e2e", cwd: ".", tail: "100", timeout: "30" }); expect(parsed.success).toBe(true);
    if (!parsed.success) throw parsed.error; const output = await command.execute!(parsed.data, { requestContext: new RequestContext(), toolCallId: "e2e-command", messages: [] } as never); expect(JSON.stringify(output)).toContain("proteus-e2e");
    expect(await readFile(join(root, "src", "fixture.ts"), "utf8")).toContain("lavender");
  } finally { await registry.destroy(); await rm(base, { recursive: true, force: true }); }
});
