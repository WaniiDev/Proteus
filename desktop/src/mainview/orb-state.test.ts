import { describe, expect, it } from "bun:test";
import type { ChatMessage, RuntimeSnapshot } from "../shared/contracts";
import { activeOrbToolNames, deriveOrbSteadyState, recoveryGate } from "./orb-state";

const baseSnapshot = (): RuntimeSnapshot => ({
  revision: 1,
  status: "ready",
  credential: { configured: true, verified: true },
  providerAuth: null,
  providers: [{ id: "openrouter", name: "OpenRouter", configured: true, verified: true, availability: "ready" }],
  models: [{ id: "openrouter/auto", providerId: "openrouter", rawId: "auto", name: "Auto Router", inputModalities: ["text"], outputModalities: ["text"] }],
  selectedProviderId: "openrouter",
  selectedModelId: "openrouter/auto",
  selectedReasoningEffort: null,
  projects: [],
  activeWorkspace: { binding: { kind: "app" }, label: "Proteus workspace", availability: "ready" },
  threads: [],
  activeThreadId: "thread-1",
  retryMessageId: null,
  messages: [],
  events: [],
  interactions: [],
  workbench: { status: "idle", tasks: [], pendingInteractions: [], queuedFollowUpCount: 0, tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
  activeRun: null,
  error: null,
});

const toolMessage = (name: string, status: "streaming_input" | "running" | "completed" = "running"): ChatMessage => ({
  id: `message-${name}`,
  role: "assistant",
  text: "",
  status: "streaming",
  createdAt: "2026-08-04T00:00:00.000Z",
  turnId: "turn-1",
  parts: [{ type: "tool", id: `tool-${name}`, toolCallId: `call-${name}`, name, label: name, status }],
});

describe("orb runtime-state resolver", () => {
  it("uses drafting only for an active write_plan tool", () => {
    const drafting = baseSnapshot();
    drafting.activeRun = { runId: "run-1", threadId: "thread-1", status: "running" };
    drafting.messages = [toolMessage("write_plan")];
    expect(activeOrbToolNames(drafting)).toEqual(new Set(["write_plan"]));
    expect(deriveOrbSteadyState(drafting)).toBe("drafting");

    drafting.messages = [toolMessage("read_plan")];
    expect(deriveOrbSteadyState(drafting)).toBe("working");
  });

  it("lets non-abort errors dominate but preserves interruption semantics", () => {
    const failed = baseSnapshot();
    failed.activeRun = { runId: "run-1", threadId: "thread-1", status: "running" };
    failed.error = { code: "model-unavailable", message: "Model unavailable", retryable: true };
    expect(deriveOrbSteadyState(failed)).toBe("error");
    failed.error = { code: "aborted", message: "Stopped", retryable: false };
    expect(deriveOrbSteadyState(failed)).toBe("thinking");
  });

  it("gates a cleared error through recovery and idle before current work", () => {
    expect(recoveryGate(true, false, "drafting")).toEqual(["recovery", "idle", "drafting"]);
    expect(recoveryGate(true, false, "error")).toBeNull();
    expect(recoveryGate(true, true, "working")).toBeNull();
  });
});
