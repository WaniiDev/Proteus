import type { ChatToolPart, WorkbenchTask } from "../shared/contracts";

type ToolRecord = Record<string, unknown>;

export type ToolActivityDetail = {
  label: string;
  value: string;
  mono?: boolean;
};

export type ToolActivityDescriptor = {
  action: string;
  target?: string;
  fullTarget?: string;
  title: string;
  outcome?: string;
  groupKey: string;
  groupLabel: string;
  countNoun: string;
  statusLabel: string;
  details: ToolActivityDetail[];
};

export type ToolActivityContext = {
  tasks?: WorkbenchTask[];
};

type ActionForms = {
  base: string;
  ongoing: string;
  past: string;
};

const TOOL_PREFIX = /^mastra_workspace_/;
const MAX_TARGET_LENGTH = 84;

function asRecord(value: unknown): ToolRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ToolRecord : undefined;
}

function stringField(record: ToolRecord | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(record: ToolRecord | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max = MAX_TARGET_LENGTH): string {
  const compact = compactWhitespace(value);
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

export function redactToolText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .replace(/\b(api[_-]?key|access[_-]?token|auth(?:orization)?|password|secret)\b(\s*[:=]\s*)([^\s;&|]+)/gi, "$1$2[redacted]")
    .replace(/([?&](?:api[_-]?key|access[_-]?token|auth|password|secret)=)[^&#\s]+/gi, "$1[redacted]");
}

export function smartPath(value: string): { display: string; full: string } {
  const full = value.replaceAll("\\", "/").replace(/^\.\//, "") || ".";
  const segments = full.split("/").filter(Boolean);
  if (full.length <= 54 || segments.length <= 3) return { display: full, full };
  return { display: `${segments[0]}/…/${segments.slice(-2).join("/")}`, full };
}

function humanizeToolName(name: string): string {
  return name
    .replace(TOOL_PREFIX, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusLabel(status: ChatToolPart["status"]): string {
  const labels: Record<ChatToolPart["status"], string> = {
    streaming_input: "Receiving tool input",
    running: "Running",
    waiting: "Waiting",
    completed: "Completed",
    error: "Failed",
    cancelled: "Cancelled",
    declined: "Declined",
  };
  return labels[status];
}

function actionFor(forms: ActionForms, status: ChatToolPart["status"], approval = false): string {
  switch (status) {
    case "streaming_input":
    case "running":
      return forms.ongoing;
    case "waiting":
      return approval ? `Waiting for approval to ${forms.base}` : `Waiting to ${forms.base}`;
    case "completed":
      return forms.past;
    case "error":
      return `Failed to ${forms.base}`;
    case "declined":
      return `Declined ${forms.ongoing.toLocaleLowerCase()}`;
    case "cancelled":
      return `Cancelled ${forms.ongoing.toLocaleLowerCase()}`;
  }
}

function outputText(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  const record = asRecord(output);
  return ["content", "summary", "message", "result"]
    .map((key) => stringField(record, key))
    .find(Boolean);
}

function taskSummary(output: unknown): string | undefined {
  const record = asRecord(output);
  const summary = asRecord(record?.summary);
  const total = numberField(summary, "total");
  const completed = numberField(summary, "completed");
  if (total !== undefined && completed !== undefined) return `${completed}/${total} tasks complete`;
  const content = outputText(output);
  const match = content?.match(/\[(\d+)\/(\d+)\s+completed\]/i);
  return match ? `${match[1]}/${match[2]} tasks complete` : undefined;
}

function genericOutcome(tool: ChatToolPart): string | undefined {
  if (tool.error) return truncate(redactToolText(tool.error), 140);
  if (tool.status !== "completed") return undefined;

  if (tool.name.startsWith("task_")) return taskSummary(tool.output);

  const output = asRecord(tool.output);
  const summary = asRecord(output?.summary);
  const matches = numberField(output, "matches") ?? numberField(output, "matchCount") ?? numberField(summary, "matches");
  const files = numberField(output, "files") ?? numberField(output, "fileCount") ?? numberField(summary, "files");
  if (matches !== undefined) return files === undefined ? `${matches} ${matches === 1 ? "match" : "matches"}` : `${matches} ${matches === 1 ? "match" : "matches"} in ${files} ${files === 1 ? "file" : "files"}`;

  const bytes = numberField(output, "bytes") ?? numberField(summary, "bytes");
  const lines = numberField(output, "lines") ?? numberField(summary, "lines");
  if (lines !== undefined || bytes !== undefined) {
    return [lines === undefined ? undefined : `${lines} ${lines === 1 ? "line" : "lines"}`, bytes === undefined ? undefined : formatBytes(bytes)].filter(Boolean).join(" · ");
  }

  const exitCode = numberField(output, "exitCode") ?? numberField(output, "code");
  if (exitCode !== undefined) return `Exited with code ${exitCode}`;

  const text = outputText(tool.output);
  if (!text) return tool.outputSummary ? truncate(redactToolText(tool.outputSummary), 140) : undefined;
  const task = text.match(/\[(\d+)\/(\d+)\s+completed\]/i);
  if (task) return `${task[1]}/${task[2]} tasks complete`;
  const grep = text.match(/(\d+)\s+matches?\s+(?:across|in)\s+(\d+)\s+files?/i);
  if (grep) return `${grep[1]} matches in ${grep[2]} files`;
  const read = text.match(/lines?\s+(\d+)\s*[-–]\s*(\d+)(?:\s+of\s+\d+)?\s*,?\s*(\d+)\s+bytes?/i);
  if (read) return `Lines ${read[1]}–${read[2]} · ${formatBytes(Number(read[3]))}`;
  const wrote = text.match(/wrote\s+(\d+)\s+bytes?/i);
  if (wrote) return formatBytes(Number(wrote[1]));
  const replacements = text.match(/(\d+)\s+(?:replacement|change)s?/i);
  if (replacements) return `${replacements[1]} ${Number(replacements[1]) === 1 ? "change" : "changes"}`;
  if (/approved/i.test(text)) return "Approved";
  if (/rejected|not approved|revision|changes requested/i.test(text)) return "Changes requested";
  return undefined;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function taskEntries(value: unknown): ToolRecord[] {
  const record = asRecord(value);
  return Array.isArray(record?.tasks) ? record.tasks.map(asRecord).filter((item): item is ToolRecord => Boolean(item)) : [];
}

function taskText(tool: ChatToolPart, context: ToolActivityContext): string | undefined {
  const input = asRecord(tool.input);
  const id = stringField(input, "id");
  const direct = stringField(input, "content");
  if (direct) return direct;
  if (tool.name === "task_write" && Array.isArray(input?.tasks)) {
    const count = input.tasks.length;
    return `${count}-task list`;
  }
  if (!id) return undefined;
  const returned = taskEntries(tool.output).find((task) => stringField(task, "id") === id);
  return stringField(returned, "content") ?? context.tasks?.find((task) => task.id === id)?.content ?? id;
}

function detail(label: string, value: string | undefined, mono = false): ToolActivityDetail | undefined {
  return value ? { label, value: redactToolText(value), ...(mono ? { mono: true } : {}) } : undefined;
}

function descriptor(
  tool: ChatToolPart,
  forms: ActionForms,
  target: string | undefined,
  options: {
    fullTarget?: string;
    groupKey: string;
    groupLabel: string;
    countNoun: string;
    approval?: boolean;
    outcome?: string;
    details?: Array<ToolActivityDetail | undefined>;
    action?: string;
  },
): ToolActivityDescriptor {
  const action = options.action ?? actionFor(forms, tool.status, options.approval);
  const title = [action, target].filter(Boolean).join(" ");
  return {
    action,
    ...(target ? { target } : {}),
    ...(options.fullTarget ? { fullTarget: options.fullTarget } : {}),
    title,
    outcome: options.outcome ?? genericOutcome(tool),
    groupKey: options.groupKey,
    groupLabel: options.groupLabel,
    countNoun: options.countNoun,
    statusLabel: statusLabel(tool.status),
    details: (options.details ?? []).filter((item): item is ToolActivityDetail => Boolean(item)),
  };
}

function pathDescriptor(
  tool: ChatToolPart,
  forms: ActionForms,
  options: Omit<Parameters<typeof descriptor>[3], "details"> & { details?: Array<ToolActivityDetail | undefined> },
): ToolActivityDescriptor {
  const input = asRecord(tool.input);
  const path = smartPath(stringField(input, "path") ?? ".");
  return descriptor(tool, forms, path.display, {
    ...options,
    fullTarget: path.full,
    details: [detail("Target", path.full, true), ...(options.details ?? [])],
  });
}

export function describeToolActivity(tool: ChatToolPart, context: ToolActivityContext = {}): ToolActivityDescriptor {
  const input = asRecord(tool.input);
  const read = { base: "read", ongoing: "Reading", past: "Read" };
  const write = { base: "write", ongoing: "Writing", past: "Wrote" };
  const edit = { base: "edit", ongoing: "Editing", past: "Edited" };

  switch (tool.name) {
    case "mastra_workspace_read_file":
    case "read_plan": {
      const offset = numberField(input, "offset");
      const limit = numberField(input, "limit");
      return pathDescriptor(tool, read, {
        groupKey: tool.name === "read_plan" ? "read_plan" : "read_file",
        groupLabel: tool.name === "read_plan" ? "Read" : "Read",
        countNoun: tool.name === "read_plan" ? "plans" : "files",
        details: [detail("Range", offset === undefined && limit === undefined ? undefined : `${offset ?? 0}${limit === undefined ? "+" : `–${(offset ?? 0) + limit}`}`, true)],
      });
    }
    case "mastra_workspace_write_file":
    case "write_plan":
      return pathDescriptor(tool, write, {
        groupKey: tool.name === "write_plan" ? "write_plan" : "write_file",
        groupLabel: "Wrote",
        countNoun: tool.name === "write_plan" ? "plans" : "files",
        approval: tool.name !== "write_plan",
      });
    case "mastra_workspace_edit_file":
      return pathDescriptor(tool, edit, { groupKey: "edit_file", groupLabel: "Edited", countNoun: "files", approval: true });
    case "mastra_workspace_delete":
      return pathDescriptor(tool, { base: "delete", ongoing: "Deleting", past: "Deleted" }, { groupKey: "delete", groupLabel: "Deleted", countNoun: "items", approval: true });
    case "mastra_workspace_mkdir":
      return pathDescriptor(tool, { base: "create folder", ongoing: "Creating folder", past: "Created folder" }, { groupKey: "mkdir", groupLabel: "Created", countNoun: "folders", approval: true });
    case "mastra_workspace_file_stat":
      return pathDescriptor(tool, { base: "inspect", ongoing: "Inspecting", past: "Inspected" }, { groupKey: "stat", groupLabel: "Inspected", countNoun: "items" });
    case "mastra_workspace_list_files":
      return pathDescriptor(tool, { base: "list files in", ongoing: "Listing files in", past: "Listed files in" }, { groupKey: "list", groupLabel: "Listed", countNoun: "folders" });
    case "mastra_workspace_grep": {
      const path = smartPath(stringField(input, "path") ?? ".");
      const query = truncate(redactToolText(stringField(input, "pattern") ?? "pattern"), 44);
      const target = `${path.display} for ${query}`;
      return descriptor(tool, { base: "search", ongoing: "Searching", past: "Searched" }, target, {
        fullTarget: `${path.full} for ${stringField(input, "pattern") ?? "pattern"}`,
        groupKey: "grep",
        groupLabel: "Searched",
        countNoun: "locations",
        details: [detail("Location", path.full, true), detail("Query", stringField(input, "pattern"), true)],
      });
    }
    case "mastra_workspace_execute_command": {
      const fullCommand = redactToolText(stringField(input, "command") ?? "command");
      const command = truncate(fullCommand.split(/\r?\n/, 1)[0] ?? "command", 80);
      return descriptor(tool, { base: "run", ongoing: "Running", past: "Ran" }, command, {
        fullTarget: fullCommand,
        groupKey: "command",
        groupLabel: "Ran",
        countNoun: "commands",
        approval: true,
        details: [detail("Command", fullCommand, true), detail("Working directory", stringField(input, "cwd"), true)],
      });
    }
    case "mastra_workspace_get_process_output": {
      const pid = stringField(input, "pid") ?? "process";
      return descriptor(tool, { base: "check process", ongoing: "Checking process", past: "Checked process" }, pid, {
        groupKey: "process_output", groupLabel: "Checked", countNoun: "processes", details: [detail("Process", pid, true)],
      });
    }
    case "mastra_workspace_kill_process": {
      const pid = stringField(input, "pid") ?? "process";
      return descriptor(tool, { base: "stop process", ongoing: "Stopping process", past: "Stopped process" }, pid, {
        groupKey: "kill_process", groupLabel: "Stopped", countNoun: "processes", approval: true, details: [detail("Process", pid, true)],
      });
    }
    case "task_write": {
      const target = taskText(tool, context) ?? "task list";
      return descriptor(tool, { base: "create", ongoing: "Creating", past: "Created" }, target, {
        groupKey: "task_write", groupLabel: "Created", countNoun: "task lists", details: [detail("Task list", target)],
      });
    }
    case "task_update": {
      const target = truncate(taskText(tool, context) ?? "task", 80);
      const requestedStatus = stringField(input, "status");
      const forms = requestedStatus === "in_progress"
        ? { base: "start", ongoing: "Starting", past: "Started" }
        : requestedStatus === "completed"
          ? { base: "complete", ongoing: "Completing", past: "Completed" }
          : requestedStatus === "pending"
            ? { base: "reopen", ongoing: "Reopening", past: "Reopened" }
            : { base: "update", ongoing: "Updating", past: "Updated" };
      return descriptor(tool, forms, target, { groupKey: `task_${forms.past.toLocaleLowerCase()}`, groupLabel: forms.past, countNoun: "tasks", details: [detail("Task", taskText(tool, context))] });
    }
    case "task_complete": {
      const target = truncate(taskText(tool, context) ?? "task", 80);
      return descriptor(tool, { base: "complete", ongoing: "Completing", past: "Completed" }, target, { groupKey: "task_complete", groupLabel: "Completed", countNoun: "tasks", details: [detail("Task", taskText(tool, context))] });
    }
    case "task_check":
      return descriptor(tool, { base: "check task progress", ongoing: "Checking task progress", past: "Checked task progress" }, undefined, { groupKey: "task_check", groupLabel: "Checked", countNoun: "task lists" });
    case "submit_plan": {
      const path = smartPath(stringField(input, "path") ?? "plan");
      const action = tool.status === "waiting" ? "Waiting for review of" : undefined;
      return descriptor(tool, { base: "submit plan", ongoing: "Submitting plan", past: "Submitted plan" }, path.display, {
        fullTarget: path.full, groupKey: "submit_plan", groupLabel: "Submitted", countNoun: "plans", action, details: [detail("Plan", path.full, true)],
      });
    }
    case "ask_user": {
      const question = truncate(stringField(input, "question") ?? "a question", 80);
      const action = tool.status === "waiting" ? "Waiting for answer:" : undefined;
      return descriptor(tool, { base: "ask", ongoing: "Asking", past: "Asked" }, question, {
        fullTarget: stringField(input, "question"), groupKey: "ask_user", groupLabel: "Asked", countNoun: "questions", action, details: [detail("Question", stringField(input, "question"))],
      });
    }
    default: {
      const friendly = tool.label && !TOOL_PREFIX.test(tool.label) ? tool.label : humanizeToolName(tool.name);
      return descriptor(tool, { base: `use ${friendly}`, ongoing: `Using ${friendly}`, past: `Used ${friendly}` }, undefined, {
        groupKey: tool.name, groupLabel: "Used", countNoun: "tools",
      });
    }
  }
}

function redactRawValue(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (/authorization|credential|token|secret|password|cookie|private.?key|api.?key/i.test(key)) return "[redacted]";
  if (typeof value === "string") return redactToolText(value);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[cyclic]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redactRawValue(entry, key, seen));
  return Object.fromEntries(Object.entries(value as ToolRecord).map(([entryKey, entry]) => [entryKey, redactRawValue(entry, entryKey, seen)]));
}

export function rawToolActivity(tool: ChatToolPart): unknown {
  return redactRawValue({
    tool: tool.name,
    status: tool.status,
    input: tool.input,
    output: tool.output,
    error: tool.error,
  });
}

export function pluralizeCount(noun: string, count: number): string {
  const singular: Record<string, string> = {
    files: "file",
    plans: "plan",
    locations: "location",
    folders: "folder",
    items: "item",
    commands: "command",
    processes: "process",
    tasks: "task",
    "task lists": "task list",
    questions: "question",
    tools: "tool",
  };
  return count === 1 ? singular[noun] ?? noun.replace(/s$/, "") : noun;
}
