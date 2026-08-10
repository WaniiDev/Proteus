import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RuntimeSnapshot } from "../shared/contracts";

mock.module("./bridge", () => ({ rpc: { request: {} } }));
const { ContextPane } = await import("./ContextPane");

function snapshot(): RuntimeSnapshot {
  return {
    revision: 1, status: "ready", credential: { configured: true, verified: true }, providerAuth: null,
    providers: [{ id: "openrouter", name: "OpenRouter", configured: true, verified: true, availability: "ready" }],
    models: [{ id: "openrouter/auto", providerId: "openrouter", rawId: "auto", name: "Auto Router", inputModalities: ["text"], outputModalities: ["text"] }],
    selectedProviderId: "openrouter", selectedModelId: "openrouter/auto", selectedReasoningEffort: null, projects: [],
    activeWorkspace: { binding: { kind: "app" }, label: "Proteus workspace", availability: "ready" },
    threads: [], activeThreadId: "thread-1", retryMessageId: null, messages: [], events: [], interactions: [], activeRun: null, error: null,
    workbench: { status: "waiting", goal: "Ship the context pane", tasks: [{ id: "one", content: "Build pane", activeForm: "Building pane", status: "in_progress" }], pendingInteractions: [{ id: "approval", toolCallId: "call", kind: "submit_plan", title: "Review", options: [], status: "pending", createdAt: "2026-08-10T00:00:00.000Z" }], queuedFollowUpCount: 1, tokenUsage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 } },
  };
}

describe("ContextPane", () => {
  it("unifies activity, workspace, skills, and details without duplicating approval actions", () => {
    const html = renderToStaticMarkup(<ContextPane snapshot={snapshot()} tab="activity" onTabChange={() => undefined} onClose={() => undefined} onJump={() => undefined} />);
    expect(html).toContain("Activity");
    expect(html).toContain("Files");
    expect(html).toContain("Search");
    expect(html).toContain("Skills");
    expect(html).toContain("Details");
    expect(html).toContain("Building pane");
    expect(html).toContain("Review plan");
    expect(html).not.toContain("Approve plan");
  });

  it("renders provider, model, workspace, and usage in details", () => {
    const html = renderToStaticMarkup(<ContextPane snapshot={snapshot()} tab="details" onTabChange={() => undefined} onClose={() => undefined} onJump={() => undefined} />);
    expect(html).toContain("Proteus workspace");
    expect(html).toContain("OpenRouter");
    expect(html).toContain("Auto Router");
    expect(html).toContain("Token usage");
  });
});
