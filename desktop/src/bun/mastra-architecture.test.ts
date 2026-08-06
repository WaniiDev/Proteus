import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const sourceRoot = join(import.meta.dir, "..");

describe("Mastra-first architecture boundaries", () => {
  it("does not reintroduce custom plan tools or follow-up queue RPCs", async () => {
    const [runtime, contracts, bunEntry, app] = await Promise.all([
      readFile(join(sourceRoot, "bun", "runtime.ts"), "utf8"),
      readFile(join(sourceRoot, "shared", "contracts.ts"), "utf8"),
      readFile(join(sourceRoot, "bun", "index.ts"), "utf8"),
      readFile(join(sourceRoot, "mainview", "App.tsx"), "utf8"),
    ]);

    expect(runtime).not.toContain("inlineSubmitPlanTool");
    expect(runtime).not.toContain("drainQueuedFollowUp");
    expect(runtime).not.toContain("proteus-session.json");
    expect(runtime).not.toContain("pendingApprovalToolName");
    expect(runtime).not.toContain("danglingApprovalThreadId");
    expect(runtime).not.toContain("A previous tool approval was interrupted");
    expect(runtime).not.toContain('if (this.snapshot.selectedProviderId === "codex") return this.startCodexRun');
    expect(runtime).not.toContain("CodexProviderRuntime");
    expect(runtime).toContain("return resolveCodexGatewayModel(modelId");
    expect(runtime).not.toContain("AgentController");
    expect(runtime).not.toContain("agentControllers:");
    expect(runtime).toContain("memory: this.memory");
    expect(runtime).toContain("this.nativeDriver.queue(");
    expect(runtime).toContain("this.nativeDriver.resume(");
    expect(runtime).toContain("workspace: this.agentWorkspace");
    expect(runtime).toContain("new ToolSearchProcessor({");
    expect(runtime).toContain('storage: "context"');
    expect(runtime).toContain("search: { topK: 3, minScore: 0.1, autoLoad: true }");
    expect(runtime).toContain("inputProcessors: [toolSearch, nativeToolCallGuard]");
    expect(runtime).toContain("web_fetch: webFetchTool");
    expect(runtime).toContain('this.snapshot.selectedProviderId === "codex"');
    expect(runtime).toContain("? webSearchTool");
    expect(runtime).toContain('openRouterTools.webSearch({ engine: "auto", maxResults: 5 })');
    expect(runtime).toContain("new RequestContext(");
    expect(runtime).toContain("contained: true");
    expect(runtime).toContain("sandboxCacheKey:");
    expect(runtime).toContain('isolation: "none"');
    expect(runtime).not.toContain("session.subscribe((event)");
    expect(`${contracts}\n${bunEntry}\n${app}`).not.toContain("chat.queue.");
    expect(`${contracts}\n${bunEntry}\n${app}`).not.toContain("chat.steer");
    expect(runtime).toContain('getStore("threadState")');
    expect(runtime).toContain("type: TASK_STATE_TYPE");
    expect(runtime).toContain("proteus.ui.v2");
    expect(runtime).toContain("tasks: _legacyTasks, toolOutcomes: _legacyToolOutcomes");
    expect(app.toLowerCase()).not.toContain("previous decisions");
    expect(app).not.toContain("TypingDots");
  });

  it("keeps workspace roots server-owned and chat bindings immutable", async () => {
    const [runtime, contracts, entry] = await Promise.all([
      readFile(join(sourceRoot, "bun", "runtime.ts"), "utf8"),
      readFile(join(sourceRoot, "shared", "contracts.ts"), "utf8"),
      readFile(join(sourceRoot, "bun", "index.ts"), "utf8"),
    ]);
    expect(runtime).toContain("requestContextFor(threadId)");
    expect(runtime).toContain("The selected project folder is unavailable");
    expect(contracts).toContain("workspaceBindingSchema");
    expect(contracts).not.toContain('"threads.workspace.update"');
    expect(entry).not.toContain("rootPath }");
  });

  it("removes the retired ACP runtime and packaged adapter", async () => {
    const [packageJson, electrobunConfig] = await Promise.all([
      readFile(join(sourceRoot, "..", "package.json"), "utf8"),
      readFile(join(sourceRoot, "..", "electrobun.config.ts"), "utf8"),
    ]);

    expect(packageJson).not.toContain("@mastra/acp");
    expect(packageJson).not.toContain("@agentclientprotocol/codex-acp");
    expect(electrobunConfig).not.toContain("codex-acp.js");
    expect(existsSync(join(sourceRoot, "bun", "codex-provider.ts"))).toBe(false);
    expect(existsSync(join(sourceRoot, "bun", "codex-acp.ts"))).toBe(false);
  });
});
