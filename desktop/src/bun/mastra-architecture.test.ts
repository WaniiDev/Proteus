import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
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
    expect(`${contracts}\n${bunEntry}\n${app}`).not.toContain("chat.queue.");
    expect(app.toLowerCase()).not.toContain("previous decisions");
    expect(app).not.toContain("TypingDots");
  });
});
