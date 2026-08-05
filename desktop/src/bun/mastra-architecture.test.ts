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
    expect(runtime).toContain("workspace: this.workspace");
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
