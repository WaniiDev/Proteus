import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatToolPart } from "../shared/contracts";
import { ToolTimeline } from "./ToolTimeline";

function tool(toolCallId: string, label: string, status: ChatToolPart["status"]): ChatToolPart {
  return {
    type: "tool",
    id: `part-${toolCallId}`,
    toolCallId,
    name: `tool_${toolCallId}`,
    label,
    status,
  };
}

describe("ToolTimeline", () => {
  it("shows every tool row immediately without disclosure elements", () => {
    const html = renderToStaticMarkup(
      <ToolTimeline
        tools={[tool("one", "Created task list", "completed"), tool("two", "Updated task", "running")]}
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
