import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatToolPart } from "../shared/contracts";
import { ToolTimeline } from "./ToolTimeline";

function tool(toolCallId: string, label: string, status: ChatToolPart["status"], name = `tool_${toolCallId}`): ChatToolPart {
  return {
    type: "tool",
    id: `part-${toolCallId}`,
    toolCallId,
    name,
    label,
    status,
  };
}

describe("ToolTimeline", () => {
  it("shows three or fewer tool rows inline without disclosure elements", () => {
    const html = renderToStaticMarkup(
      <ToolTimeline
        tools={[tool("one", "Created task list", "completed", "task_update"), tool("two", "Updated task", "running", "task_update")]}
        live
        pendingIds={new Set()}
      />,
    );

    expect(html).toContain("Using tools");
    expect(html).toContain("Created task list");
    expect(html).toContain("Updated task");
    expect(html.indexOf("Created task list")).toBeLessThan(html.indexOf("Updated task"));
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
  });

  it("collapses a completed run with more than three calls and repeated tool names", () => {
    const html = renderToStaticMarkup(
      <ToolTimeline
        tools={[
          tool("write-one", "Write Plan", "completed", "write_plan"),
          tool("submit-one", "Submitted plan", "completed", "submit_plan"),
          tool("read", "Read Plan", "completed", "read_plan"),
          tool("write-two", "Write Plan", "completed", "write_plan"),
          tool("submit-two", "Submitted plan", "completed", "submit_plan"),
        ]}
        live={false}
        pendingIds={new Set()}
      />,
    );

    expect(html).toContain('<details class="tool-timeline-disclosure">');
    expect(html).toContain("<summary>");
    expect(html).toContain("Write Plan<small>×2</small>");
    expect(html).toContain("Submitted plan<small>×2</small>");
    expect(html).not.toContain('open=""');
    expect(html.indexOf("Write Plan")).toBeLessThan(html.lastIndexOf("Submitted plan"));
  });

  it("keeps a repetitive group expanded while it is live or needs attention", () => {
    const tools = [
      tool("one", "Updated task", "completed", "task_update"),
      tool("two", "Updated task", "completed", "task_update"),
      tool("three", "Updated task", "completed", "task_update"),
      tool("four", "Updated task", "running", "task_update"),
    ];
    const liveHtml = renderToStaticMarkup(<ToolTimeline tools={tools} live pendingIds={new Set()} />);
    const attentionHtml = renderToStaticMarkup(<ToolTimeline tools={tools} live={false} pendingIds={new Set()} />);

    expect(liveHtml).toContain('open=""');
    expect(attentionHtml).toContain('open=""');
  });

  it("keeps longer non-repetitive runs inline", () => {
    const html = renderToStaticMarkup(
      <ToolTimeline
        tools={[
          tool("one", "Read Plan", "completed", "read_plan"),
          tool("two", "Write Plan", "completed", "write_plan"),
          tool("three", "Submitted plan", "completed", "submit_plan"),
          tool("four", "Checked progress", "completed", "task_check"),
        ]}
        live={false}
        pendingIds={new Set()}
      />,
    );

    expect(html).not.toContain("<details");
  });

  it("keeps interaction tools out of the activity feed when they have their own pending card", () => {
    const html = renderToStaticMarkup(
      <ToolTimeline
        tools={[tool("question", "Asked for input", "waiting"), tool("work", "Updated task", "completed")]}
        live
        pendingIds={new Set(["question"])}
      />,
    );

    expect(html).not.toContain("Asked for input");
    expect(html).toContain("Updated task");
  });
});
