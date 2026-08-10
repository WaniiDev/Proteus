import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatToolPart } from "../shared/contracts";
import { ToolTimeline } from "./ToolTimeline";

const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");

function tool(toolCallId: string, name: string, status: ChatToolPart["status"], input?: unknown, output?: unknown): ChatToolPart {
  return {
    type: "tool",
    id: `part-${toolCallId}`,
    toolCallId,
    name,
    label: name,
    status,
    input,
    output,
  };
}

describe("ToolTimeline", () => {
  it("shows one or two semantic rows without a redundant tool-count heading", () => {
    const html = renderToStaticMarkup(
      <ToolTimeline
        tools={[
          tool("one", "mastra_workspace_grep", "completed", { path: "desktop/src", pattern: "ToolTimeline" }, "4 matches across 2 files"),
          tool("two", "mastra_workspace_read_file", "running", { path: "desktop/src/mainview/ToolTimeline.tsx" }),
        ]}
        live
        pendingIds={new Set()}
      />,
    );

    expect(html).not.toContain("Using tools");
    expect(html).toContain("Searched");
    expect(html).toContain("desktop/src for ToolTimeline");
    expect(html).toContain("Reading");
    expect(html.indexOf("Searched")).toBeLessThan(html.indexOf("Reading"));
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("Mastra Workspace");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("tool-state");
    expect(html).not.toContain("tool-row-chevron");
    expect(html).not.toContain("Completed</span>");
    expect(html).not.toContain("tool-timeline-disclosure");
  });

  it("keeps the tool-count heading hidden for three inline calls", () => {
    const html = renderToStaticMarkup(
      <ToolTimeline
        tools={[
          tool("one", "mastra_workspace_read_file", "completed", { path: "one.ts" }),
          tool("two", "mastra_workspace_read_file", "completed", { path: "two.ts" }),
          tool("three", "mastra_workspace_read_file", "running", { path: "three.ts" }),
        ]}
        live
        pendingIds={new Set()}
      />,
    );

    expect(html).not.toContain("Using tools");
    expect(html).toContain("tool-running");
  });

  it("collapses a completed run with action-count summaries", () => {
    const html = renderToStaticMarkup(
      <ToolTimeline
        tools={[
          tool("write-one", "write_plan", "completed", { path: "plans/example.md" }),
          tool("submit-one", "submit_plan", "completed", { path: "plans/example.md" }),
          tool("read", "read_plan", "completed", { path: "plans/example.md" }),
          tool("write-two", "write_plan", "completed", { path: "plans/example.md" }),
          tool("submit-two", "submit_plan", "completed", { path: "plans/example.md" }),
        ]}
        live={false}
        pendingIds={new Set()}
      />,
    );

    expect(html).toContain('<details class="tool-timeline-disclosure">');
    expect(html).toContain("Tools used");
    expect(html).toContain("Wrote 2 plans");
    expect(html).toContain("Submitted 2 plans");
    expect(html).toContain("Read 1 plan");
    expect(html).not.toContain('open=""');
  });

  it("caps the collapsed summary at three activity groups", () => {
    const html = renderToStaticMarkup(
      <ToolTimeline
        tools={[
          tool("read-one", "read_plan", "completed", { path: "plans/example.md" }),
          tool("read-two", "read_plan", "completed", { path: "plans/example.md" }),
          tool("write", "write_plan", "completed", { path: "plans/example.md" }),
          tool("submit", "submit_plan", "completed", { path: "plans/example.md" }),
          tool("check", "task_check", "completed", {}),
          tool("grep", "mastra_workspace_grep", "completed", { path: "src", pattern: "TODO" }),
        ]}
        live={false}
        pendingIds={new Set()}
      />,
    );

    expect(html).toContain("Read 2 plans");
    expect(html).toContain("Wrote 1 plan");
    expect(html).toContain("Submitted 1 plan");
    expect(html).toContain("+2 more");
    expect(html).not.toContain("Checked 1 task");
    expect(html).not.toContain("Searched 1 search");
    expect(html.match(/tool-row-disclosure/g)).toHaveLength(6);
  });

  it("keeps a repetitive group expanded while live or needing attention", () => {
    const tools = [
      tool("one", "task_update", "completed", { id: "one", content: "First task" }),
      tool("two", "task_update", "completed", { id: "two", content: "Second task" }),
      tool("three", "task_update", "completed", { id: "three", content: "Third task" }),
      tool("four", "task_update", "running", { id: "four", content: "Fourth task" }),
    ];
    const liveHtml = renderToStaticMarkup(<ToolTimeline tools={tools} live pendingIds={new Set()} />);
    const attentionHtml = renderToStaticMarkup(<ToolTimeline tools={tools} live={false} pendingIds={new Set()} />);

    expect(liveHtml).toContain('open=""');
    expect(attentionHtml).toContain('open=""');
    expect(liveHtml).toContain("Updated 4 tasks");
  });

  it("keeps longer non-repetitive runs inline", () => {
    const html = renderToStaticMarkup(
      <ToolTimeline
        tools={[
          tool("one", "read_plan", "completed", { path: "plans/example.md" }),
          tool("two", "write_plan", "completed", { path: "plans/example.md" }),
          tool("three", "submit_plan", "completed", { path: "plans/example.md" }),
          tool("four", "task_check", "completed", {}),
        ]}
        live={false}
        pendingIds={new Set()}
      />,
    );

    expect(html).not.toContain("tool-timeline-disclosure");
    expect(html).not.toContain("tool-timeline-head");
  });

  it("renders expandable human and sanitized raw details", () => {
    const html = renderToStaticMarkup(
      <ToolTimeline
        tools={[tool("read", "mastra_workspace_read_file", "completed", { path: "desktop/package.json", offset: 0, limit: 50 }, "desktop/package.json (lines 1-50 of 50, 1775 bytes)")]}
        live={false}
        pendingIds={new Set()}
      />,
    );

    expect(html).toContain("tool-row-disclosure");
    expect(html).toContain("Target");
    expect(html).toContain("desktop/package.json");
    expect(html).toContain("Result");
    expect(html).toContain("Lines 1–50 · 1.8 KB");
    expect(html).toContain("Raw details");
    expect(html).toContain("mastra_workspace_read_file");
  });

  it("keeps interaction tools out of the activity feed while their card is pending", () => {
    const html = renderToStaticMarkup(
      <ToolTimeline
        tools={[
          tool("question", "ask_user", "waiting", { question: "Which design?" }),
          tool("work", "task_update", "completed", { id: "task", content: "Review the design" }),
        ]}
        live
        pendingIds={new Set(["question"])}
      />,
    );

    expect(html).not.toContain("Which design?");
    expect(html).toContain("Updated");
    expect(html).toContain("Review the design");
  });

  it("uses a spinner for active calls and respects reduced motion", () => {
    expect(css).toContain(".tool-running .tool-status-dot, .tool-streaming_input .tool-status-dot");
    expect(css).toContain("animation: toolIconSpin .72s linear infinite");
    expect(css).toContain("@keyframes toolIconSpin");
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*\.tool-status-dot[^}]*animation:\s*none\s*!important/);
    expect(css).not.toContain(".tool-row-chevron");
  });
});
