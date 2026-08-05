import { describe, expect, it } from "bun:test";
import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { emptyCodexProjection, mapCodexModels, projectCodexUpdate } from "./codex-provider";

describe("Codex ACP projection", () => {
  it("maps native composite IDs to provider models and reasoning metadata", () => {
    const models = mapCodexModels([
      { modelId: "gpt-5.6-sol[low]", name: "GPT-5.6 Sol (low)", description: "Fast" },
      { modelId: "gpt-5.6-sol[high]", name: "GPT-5.6 Sol (high)", description: "Deep" },
    ]);
    expect(models[1]?.id).toBe("codex/gpt-5.6-sol[high]");
    expect(models[1]?.reasoningEffort).toBe("high");
    expect(models[1]?.reasoningOptions).toEqual(["low", "high"]);
  });

  it("projects streamed text, tool lifecycle, plan tasks, and usage", () => {
    let state = emptyCodexProjection();
    state = projectCodexUpdate(state, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } } as SessionUpdate);
    state = projectCodexUpdate(state, { sessionUpdate: "tool_call", toolCallId: "tool-1", title: "Read file", kind: "read", status: "in_progress", rawInput: { path: "README.md" } } as SessionUpdate);
    state = projectCodexUpdate(state, { sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed", rawOutput: "done" } as SessionUpdate);
    state = projectCodexUpdate(state, { sessionUpdate: "plan", entries: [{ content: "Inspect", priority: "high", status: "completed" }] } as SessionUpdate);
    state = projectCodexUpdate(state, { sessionUpdate: "usage_update", used: 120, size: 10_000 } as SessionUpdate);
    expect(state.text).toBe("Hello");
    expect(state.tools.get("tool-1")?.status).toBe("completed");
    expect(state.tasks[0]?.status).toBe("completed");
    expect(state.usage.totalTokens).toBe(120);
  });

  it("documents one-time transcript seeding at the ACP session boundary", async () => {
    const source = await Bun.file(new URL("./codex-provider.ts", import.meta.url)).text();
    expect(source).toContain("isNewSession && transcript.trim()");
    expect(source).toContain("<proteus_transcript>");
  });
});
