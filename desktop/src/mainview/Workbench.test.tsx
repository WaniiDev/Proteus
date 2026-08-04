import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RuntimeSnapshot } from "../shared/contracts";
import { Workbench } from "./Workbench";

function snapshot(): RuntimeSnapshot {
  return {
    revision: 1,
    status: "ready",
    credential: { configured: true, verified: true },
    models: [{ id: "openrouter/auto", rawId: "auto", name: "Auto Router", inputModalities: ["text"], outputModalities: ["text"] }],
    selectedModelId: "openrouter/auto",
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
  it("renders relevant work as a persistent panel without overlay controls", () => {
    const html = renderToStaticMarkup(<Workbench snapshot={snapshot()} onJump={() => undefined} />);

    expect(html).toContain('<aside class="workbench"');
    expect(html).toContain("Ship the side panel");
    expect(html).toContain("Building the layout");
    expect(html).toContain("Plan approval");
    expect(html).toContain("Needs you");
    expect(html).toContain("Session details");
    expect(html).not.toContain("workbench-scrim");
    expect(html).not.toContain("Close Workbench");
  });

  it("keeps the Workbench in a 70/30 normal-flow layout with a narrow stack", async () => {
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text();
    const app = await Bun.file(new URL("./App.tsx", import.meta.url)).text();

    expect(css).toContain("grid-template-columns: minmax(0, 7fr) minmax(0, 3fr)");
    expect(css).toContain("@media (max-width: 1023px)");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr); grid-template-rows:");
    expect(css).not.toContain(".companion-view .workbench-scrim");
    expect(css).not.toContain(".companion-view .workbench { position: fixed");
    expect(app).not.toContain("workbenchOpen");
    expect(app).not.toContain("Close Workbench");
  });
});
