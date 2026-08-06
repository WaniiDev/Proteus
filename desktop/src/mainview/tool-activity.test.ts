import { describe, expect, it } from "bun:test";
import type { ChatToolPart, WorkbenchTask } from "../shared/contracts";
import { describeToolActivity, rawToolActivity, smartPath } from "./tool-activity";

function tool(name: string, status: ChatToolPart["status"] = "completed", input?: unknown, output?: unknown, error?: string): ChatToolPart {
  return {
    type: "tool",
    id: `part-${name}`,
    toolCallId: `call-${name}`,
    name,
    label: name,
    status,
    input,
    output,
    error,
  };
}

describe("tool activity descriptions", () => {
  it("uses root and the final two path segments for long targets", () => {
    expect(smartPath("desktop/src/features/conversation/tooling/components/timeline/runtime.ts")).toEqual({
      display: "desktop/…/timeline/runtime.ts",
      full: "desktop/src/features/conversation/tooling/components/timeline/runtime.ts",
    });
    expect(smartPath("desktop/package.json").display).toBe("desktop/package.json");
  });

  it("uses dynamic natural language for file lifecycle states", () => {
    const input = { path: "desktop/src/bun/runtime.ts", showLineNumbers: true };
    expect(describeToolActivity(tool("mastra_workspace_read_file", "running", input)).title).toBe("Reading desktop/src/bun/runtime.ts");
    expect(describeToolActivity(tool("mastra_workspace_read_file", "completed", input)).title).toBe("Read desktop/src/bun/runtime.ts");
    expect(describeToolActivity(tool("mastra_workspace_edit_file", "waiting", input)).title).toBe("Waiting for approval to edit desktop/src/bun/runtime.ts");
    expect(describeToolActivity(tool("mastra_workspace_edit_file", "error", input, undefined, "Patch failed")).title).toBe("Failed to edit desktop/src/bun/runtime.ts");
  });

  it("shows grep query and location with a compact result", () => {
    const activity = describeToolActivity(tool(
      "mastra_workspace_grep",
      "completed",
      { path: "desktop/src", pattern: "createCodeMode", contextLines: 2 },
      "286 matches across 96 files — first result",
    ));
    expect(activity.title).toBe("Searched desktop/src for createCodeMode");
    expect(activity.outcome).toBe("286 matches in 96 files");
    expect(activity.details).toContainEqual({ label: "Query", value: "createCodeMode", mono: true });
  });

  it("summarizes read ranges and write sizes", () => {
    const read = describeToolActivity(tool("mastra_workspace_read_file", "completed", { path: "desktop/package.json" }, "desktop/package.json (lines 1-50 of 50, 1775 bytes)"));
    const write = describeToolActivity(tool("mastra_workspace_write_file", "completed", { path: "example.txt" }, "Wrote 530 bytes to example.txt"));
    expect(read.outcome).toBe("Lines 1–50 · 1.8 KB");
    expect(write.outcome).toBe("530 B");
  });

  it("redacts secret-like command values in the title and raw view", () => {
    const activityTool = tool("mastra_workspace_execute_command", "completed", { command: "curl -H 'Authorization: Bearer top-secret-value' https://example.test?api_key=abc123" }, { exitCode: 0, token: "hidden" });
    const activity = describeToolActivity(activityTool);
    const raw = JSON.stringify(rawToolActivity(activityTool));
    expect(activity.title).not.toContain("top-secret-value");
    expect(activity.title).not.toContain("abc123");
    expect(activity.outcome).toBe("Exited with code 0");
    expect(raw).not.toContain("top-secret-value");
    expect(raw).not.toContain("abc123");
    expect(raw).not.toContain("hidden");
  });

  it("resolves task IDs to human task text", () => {
    const tasks: WorkbenchTask[] = [{ id: "task_inspect", content: "Inspect key project files", activeForm: "Inspecting key project files", status: "in_progress" }];
    const running = describeToolActivity(tool("task_complete", "running", { id: "task_inspect" }), { tasks });
    const completed = describeToolActivity(tool("task_complete", "completed", { id: "task_inspect" }, {
      tasks: [{ ...tasks[0], status: "completed" }],
      summary: { total: 3, completed: 2 },
    }));
    expect(running.title).toBe("Completing Inspect key project files");
    expect(completed.title).toBe("Completed Inspect key project files");
    expect(completed.outcome).toBe("2/3 tasks complete");
  });

  it("describes task creation and status updates without exposing IDs", () => {
    const created = describeToolActivity(tool("task_write", "completed", {
      tasks: [
        { id: "one", content: "First", activeForm: "Doing first", status: "pending" },
        { id: "two", content: "Second", activeForm: "Doing second", status: "pending" },
      ],
    }));
    const started = describeToolActivity(tool("task_update", "completed", { id: "one", content: "First", status: "in_progress" }));
    const reopened = describeToolActivity(tool("task_update", "completed", { id: "one", content: "First", status: "pending" }));
    expect(created.title).toBe("Created 2-task list");
    expect(started.title).toBe("Started First");
    expect(reopened.title).toBe("Reopened First");
  });

  it("uses meaningful plan and input waiting states", () => {
    expect(describeToolActivity(tool("submit_plan", "waiting", { path: ".mastracode/plans/refactor.md" })).title).toBe("Waiting for review of .mastracode/plans/refactor.md");
    expect(describeToolActivity(tool("ask_user", "waiting", { question: "Which design should we use?" })).title).toBe("Waiting for answer: Which design should we use?");
  });

  it("keeps unknown future tools readable without provider prefixes", () => {
    const activity = describeToolActivity(tool("mastra_workspace_future_inspect", "completed"));
    expect(activity.title).toBe("Used Future Inspect");
    expect(activity.title).not.toContain("mastra_workspace");
  });

  it("describes working utilities and dynamic web discovery semantically", () => {
    expect(describeToolActivity(tool("search_tools", "completed", { query: "fetch a web page" })).title).toBe("Found tools for fetch a web page");
    expect(describeToolActivity(tool("web_fetch", "running", { url: "https://mastra.ai/docs" })).title).toBe("Fetching https://mastra.ai/docs");
    expect(describeToolActivity(tool("web_search", "completed", { query: "Mastra tools" })).title).toBe("Searched the web for Mastra tools");
    expect(describeToolActivity(tool("get_datetime", "completed", { timezone: "Asia/Bangkok" })).title).toBe("Checked time in Asia/Bangkok");
    expect(describeToolActivity(tool("calculate", "completed", { expression: "2 + 2" })).title).toBe("Calculated 2 + 2");
    expect(describeToolActivity(tool("convert_units", "completed", { value: 1, from: "km", to: "m" })).title).toBe("Converted 1 km to m");
  });

  it("covers every enabled workspace operation with a semantic title", () => {
    const cases: Array<[string, unknown, string]> = [
      ["mastra_workspace_write_file", { path: "notes.txt" }, "Wrote notes.txt"],
      ["mastra_workspace_edit_file", { path: "notes.txt" }, "Edited notes.txt"],
      ["mastra_workspace_delete", { path: "notes.txt" }, "Deleted notes.txt"],
      ["mastra_workspace_mkdir", { path: "reports" }, "Created folder reports"],
      ["mastra_workspace_file_stat", { path: "notes.txt" }, "Inspected notes.txt"],
      ["mastra_workspace_list_files", { path: "desktop/src" }, "Listed files in desktop/src"],
      ["mastra_workspace_get_process_output", { pid: "42" }, "Checked process 42"],
      ["mastra_workspace_kill_process", { pid: "42" }, "Stopped process 42"],
    ];
    for (const [name, input, title] of cases) {
      const activity = describeToolActivity(tool(name, "completed", input));
      expect(activity.title).toBe(title);
      expect(activity.title).not.toContain("mastra_workspace");
    }
  });
});
