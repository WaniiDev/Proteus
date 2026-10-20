import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatToolPart } from "../../shared/contracts";
import { useDom } from "../test/dom";
import { ToolTimeline } from "./ToolTimeline";

useDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dsCss = readFileSync(new URL("../ds/bundle.css", import.meta.url), "utf8");

function tool(toolCallId: string, name: string, status: ChatToolPart["status"], input?: unknown, output?: unknown, error?: string): ChatToolPart {
  return { type: "tool", id: `part-${toolCallId}`, toolCallId, name, label: name, status, input, output, ...(error ? { error } : {}) };
}

const render = (tools: ChatToolPart[], live = false, pending: string[] = []) =>
  renderToStaticMarkup(<ToolTimeline tools={tools} live={live} pendingIds={new Set(pending)} />);

const reads = (count: number, status: ChatToolPart["status"] = "completed") =>
  Array.from({ length: count }, (_, i) => tool(`r${i}`, "mastra_workspace_read_file", status, { path: `src/file-${i}.ts` }));

describe("ToolTimeline as a StepList", () => {
  it("renders .steps > .step with a mark and verb, target and note", () => {
    const html = render([tool("one", "mastra_workspace_grep", "completed", { path: "desktop/src", pattern: "ToolTimeline" }, "4 matches across 2 files")], true);
    expect(html).toContain('class="steps"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("step-mark done");
    expect(html).toContain('class="step-target"');
    expect(html).toContain("desktop/src for ToolTimeline");
    expect(html).toContain("step-note");
    expect(html).toContain("4 matches in 2 files");
    expect(html).not.toContain("Using tools");
    expect(html).not.toContain("tool-");
  });

  it("maps every status to a mark", () => {
    const mark = (status: ChatToolPart["status"]) => render([tool("x", "mastra_workspace_read_file", status, { path: "a.ts" })]).match(/step-mark ([a-z ]+?)"/)?.[1];
    expect(mark("running")).toBe("run");
    expect(mark("streaming_input")).toBe("run");
    expect(mark("completed")).toBe("done");
    expect(mark("waiting")).toBe("wait");
    expect(mark("error")).toBe("no error");
    expect(mark("declined")).toBe("no");
    expect(mark("cancelled")).toBe("no");
  });

  it("uses the present participle while running and the past tense when done, in one cell", () => {
    const running = render([tool("x", "mastra_workspace_read_file", "running", { path: "a.ts" })]);
    const done = render([tool("x", "mastra_workspace_read_file", "completed", { path: "a.ts" })]);
    expect(running).toContain('<span data-on="true">Reading</span><span data-on="false" aria-hidden="true">Read</span>');
    expect(done).toContain('<span data-on="false" aria-hidden="true">Reading</span><span data-on="true">Read</span>');
  });

  it("shows the runtime's message as the note on an error", () => {
    const html = render([tool("x", "mastra_workspace_read_file", "error", { path: "a.ts" }, undefined, "Permission denied")]);
    expect(html).toContain("step-mark no error");
    expect(html).toContain("Failed to read");
    expect(html).toContain("Permission denied");
  });

  it("truncates long targets and keeps the full one in the title", () => {
    const long = `${"deeply/nested/".repeat(12)}file.ts`;
    const html = render([tool("x", "mastra_workspace_read_file", "completed", { path: long })]);
    expect(html).toContain(`title="${long}"`);
    expect(html).not.toContain(`>${long}<`);
    expect(html).toContain("…");
  });

  it("keeps interaction tools out of the list while their card is pending", () => {
    const html = render([tool("question", "ask_user", "waiting", { question: "Which design?" }), tool("work", "task_update", "completed", { id: "t", content: "Review the design" })], true, ["question"]);
    expect(html).not.toContain("Which design?");
    expect(html).toContain("Review the design");
    expect(render([tool("q", "ask_user", "waiting", {})], true, ["q"])).toBe("");
  });

  it("keeps three or fewer calls, and non-repetitive runs, inline", () => {
    expect(render(reads(3))).not.toContain("step-group");
    const mixed = [tool("1", "read_plan", "completed", { path: "p.md" }), tool("2", "write_plan", "completed", { path: "p.md" }), tool("3", "submit_plan", "completed", { path: "p.md" }), tool("4", "task_check", "completed", {})];
    expect(render(mixed)).not.toContain("step-group");
  });

  it("never collapses a live list or one that needs attention", () => {
    expect(render(reads(5), true)).not.toContain("step-group");
    expect(render([...reads(4), tool("w", "mastra_workspace_write_file", "waiting", { path: "x" })])).not.toContain("step-group");
  });

  it("collapses a finished run to a summary with an aria-expanded button", () => {
    const html = render(reads(12));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Read 12 files");
    expect(html).not.toContain('class="step ');
  });

  it("caps the summary at three groups", () => {
    const html = render([
      tool("a", "read_plan", "completed", { path: "p.md" }), tool("b", "read_plan", "completed", { path: "p.md" }),
      tool("c", "write_plan", "completed", { path: "p.md" }), tool("d", "submit_plan", "completed", { path: "p.md" }),
      tool("e", "task_check", "completed", {}), tool("f", "mastra_workspace_grep", "completed", { path: "src", pattern: "T" }),
    ]);
    expect(html).toContain("Read 2 plans · Wrote 1 plan · Submitted 1 plan · +2 more");
  });

  it("expands and collapses from the keyboard", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(<ToolTimeline tools={reads(12)} live={false} pendingIds={new Set()} />); });
    const button = host.querySelector<HTMLButtonElement>("button.step-group")!;
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelectorAll(".step")).toHaveLength(0);
    // A real button activates on Enter and Space through a click.
    await act(async () => { button.click(); });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelectorAll(".step")).toHaveLength(12);
    await act(async () => { button.click(); });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it("stays clear without motion: words and marks carry the state, and the design system stills the pulse", () => {
    const html = render([tool("a", "mastra_workspace_read_file", "running", { path: "a.ts" }), tool("b", "mastra_workspace_read_file", "waiting", { path: "b.ts" })], true);
    expect(html).toContain("Reading");
    expect(html).toContain('aria-label="Running"');
    expect(html).toContain('aria-label="Waiting"');
    expect(html).not.toContain("style=");
    const block = dsCss.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(block).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(block).toMatch(/animation-duration:\s*1ms\s*!important/);
    expect(block).toMatch(/transition-duration:\s*1ms\s*!important/);
  });
});
