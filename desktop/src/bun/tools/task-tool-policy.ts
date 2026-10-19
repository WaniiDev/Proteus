import type { ProcessInputStepArgs, ProcessInputStepResult } from "@mastra/core/processors";
import type { TaskItemSnapshot, ToolHooks } from "@mastra/core/tools";

const TASK_TOOLS = new Set(["task_write", "task_update", "task_complete", "task_check"]);

type NativeTaskOutput = {
  content: string;
  tasks: TaskItemSnapshot[];
  isError: boolean;
  summary?: { allCompleted?: boolean };
};

type RunState = {
  lastSignature?: string;
  lastBlockedSignature?: string;
  lastOutput?: NativeTaskOutput;
  textOnly: boolean;
};

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

function threadIdFromContext(context: unknown): string {
  if (!context || typeof context !== "object") return "unknown";
  const value = context as { agent?: { threadId?: unknown }; requestContext?: { get?: (key: string) => unknown } };
  const controller = value.requestContext?.get?.("controller");
  const controllerThreadId = controller && typeof controller === "object" ? (controller as { threadId?: unknown }).threadId : undefined;
  if (typeof controllerThreadId === "string" && controllerThreadId) return controllerThreadId;
  return typeof value.agent?.threadId === "string" && value.agent.threadId ? value.agent.threadId : "unknown";
}

function nativeTaskOutput(value: unknown): NativeTaskOutput | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.tasks)) return undefined;
  const tasks = record.tasks.filter((task): task is TaskItemSnapshot => {
    if (!task || typeof task !== "object") return false;
    const item = task as Record<string, unknown>;
    return typeof item.id === "string" && typeof item.content === "string" && typeof item.activeForm === "string" && ["pending", "in_progress", "completed"].includes(String(item.status));
  });
  if (tasks.length !== record.tasks.length) return undefined;
  return {
    content: typeof record.content === "string" ? record.content : "Task state returned by Mastra.",
    tasks,
    isError: record.isError === true,
    ...(record.summary && typeof record.summary === "object" ? { summary: record.summary as { allCompleted?: boolean } } : {}),
  };
}

function terminalTaskCheck(steps: unknown[]): boolean {
  return steps.some((step) => {
    if (!step || typeof step !== "object" || !Array.isArray((step as { toolResults?: unknown }).toolResults)) return false;
    return ((step as { toolResults: unknown[] }).toolResults).some((result) => {
      if (!result || typeof result !== "object") return false;
      const value = result as { toolName?: unknown; output?: unknown; result?: unknown };
      const output = nativeTaskOutput(value.output ?? value.result);
      return value.toolName === "task_check" && output?.isError === false && output.summary?.allCompleted === true;
    });
  });
}

/**
 * Run-local execution guard. TaskSignalProvider remains the only owner of task
 * IDs, validation, persistence, and state; this merely prevents an LLM from
 * issuing the exact same call twice and ends after native allCompleted.
 */
export class TaskToolPolicy {
  private readonly runs = new Map<string, RunState>();

  readonly hooks: ToolHooks = {
    beforeToolCall: ({ toolName, input, context }) => {
      if (!TASK_TOOLS.has(toolName)) return;
      const state = this.runs.get(threadIdFromContext(context));
      if (!state?.lastOutput) return;
      const signature = `${toolName}:${stableValue(input)}`;
      const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
      const task = typeof record.id === "string" ? state.lastOutput.tasks.find((item) => item.id === record.id) : undefined;
      const updateKeys = (["content", "status", "activeForm"] as const).filter((key) => record[key] !== undefined);
      const alreadyApplied = toolName === "task_update" && task && updateKeys.length > 0 && updateKeys.every((key) => task[key] === record[key]);
      const reopensCompleted = toolName === "task_update" && task?.status === "completed" && (record.status === "pending" || record.status === "in_progress");
      const completesCompleted = toolName === "task_complete" && task?.status === "completed";
      const rejectedBySnapshot = alreadyApplied || reopensCompleted || completesCompleted;
      const exactRepeat = state.lastSignature === signature || state.lastBlockedSignature === signature;
      if (!state.textOnly && !exactRepeat && !rejectedBySnapshot) return;
      if (exactRepeat) state.textOnly = true;
      if (rejectedBySnapshot) state.lastBlockedSignature = signature;
      return {
        proceed: false,
        output: {
          ...state.lastOutput,
          content: "This exact task call already ran. Use the current native task state and give the user the result.",
          isError: false,
        },
      };
    },
    afterToolCall: ({ toolName, input, output, context }) => {
      if (!TASK_TOOLS.has(toolName)) return;
      const parsed = nativeTaskOutput(output);
      if (!parsed) return;
      this.runs.set(threadIdFromContext(context), {
        lastSignature: `${toolName}:${stableValue(input)}`,
        lastBlockedSignature: undefined,
        lastOutput: parsed,
        textOnly: parsed.isError === false && toolName === "task_check" && parsed.summary?.allCompleted === true,
      });
    },
  };

  readonly prepareStep = (args: ProcessInputStepArgs): ProcessInputStepResult | undefined => {
    const threadId = threadIdFromContext(args);
    // Mastra calls step zero synchronously before it assembles the provider
    // request. This is the authoritative new-run boundary. Resetting from the
    // asynchronously projected `start` chunk races with request assembly and
    // can leak a completed task run's text-only state into the next user turn.
    if (args.stepNumber === 0) {
      this.runs.delete(threadId);
      return undefined;
    }
    if (this.runs.get(threadId)?.textOnly || terminalTaskCheck(args.steps)) return { toolChoice: "none" };
    return undefined;
  };

  reset(threadId?: string): void {
    if (threadId) this.runs.delete(threadId);
    else this.runs.clear();
  }
}
