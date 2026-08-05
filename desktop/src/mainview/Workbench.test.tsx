import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RuntimeSnapshot } from "../shared/contracts";
import { Workbench } from "./Workbench";

function snapshot(): RuntimeSnapshot {
  return {
    revision: 1,
    status: "ready",
  credential: { configured: true, verified: true },
  providerAuth: null,
    providers: [{ id: "openrouter", name: "OpenRouter", configured: true, verified: true, availability: "ready" }],
    models: [{ id: "openrouter/auto", providerId: "openrouter", rawId: "auto", name: "Auto Router", inputModalities: ["text"], outputModalities: ["text"] }],
    selectedProviderId: "openrouter",
    selectedModelId: "openrouter/auto",
    selectedReasoningEffort: null,
    threads: [],
    activeThreadId: "thread-1",
    retryMessageId: null,
    messages: [],
    events: [],
    interactions: [],
    toolApproval: null,
    workbench: {
      status: "waiting",
      goal: "Ship the side panel",
      tasks: [
        { id: "layout", content: "Build the layout", activeForm: "Building the layout", status: "in_progress" },
        { id: "tests", content: "Verify the layout", activeForm: "Verifying the layout", status: "pending" },
      ],
      pendingInteractions: [
        { id: "interaction-1", toolCallId: "call-1", kind: "submit_plan", title: "Review plan", options: [], status: "pending", createdAt: "2026-08-04T00:00:00.000Z" },
      ],
      queuedFollowUpCount: 0,
      tokenUsage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
    },
    activeRun: null,
    error: null,
  };
}

describe("Workbench", () => {
  it("renders relevant work with a manual close control", () => {
    const html = renderToStaticMarkup(<Workbench snapshot={snapshot()} onJump={() => undefined} onClose={() => undefined} />);

    expect(html).toContain('<aside class="workbench"');
    expect(html).toContain("Ship the side panel");
    expect(html).toContain("Building the layout");
    expect(html).toContain("Plan approval");
    expect(html).toContain("Needs you");
    expect(html).toContain("Session details");
    expect(html).not.toContain("workbench-scrim");
    expect(html).toContain("Close Workbench");
  });

  it("uses a desktop split, tablet drawer, and mobile bottom sheet", async () => {
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text();
    const app = await Bun.file(new URL("./App.tsx", import.meta.url)).text();

    expect(css).toContain("grid-template-columns: minmax(0, 7fr) minmax(0, 3fr)");
    expect(css).toContain("@media (min-width: 761px) and (max-width: 1023px)");
    expect(css).toContain("inset: 58px 0 0 auto");
    expect(css).toContain("@media (max-width: 760px)");
    expect(css).toContain("inset: auto 8px 8px");
    expect(css).toContain(".workbench-backdrop");
    expect(app).toContain("workbenchOpenByThread");
    expect(app).toContain("Open Workbench");
    expect(app).toContain("Close Workbench");
    expect(app).toContain('className="workbench-backdrop"');
  });
});
