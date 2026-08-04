import type { ToolHooks } from "@mastra/core/tools";

const TASK_TOOLS = new Set(["task_write", "task_update", "task_complete", "task_check"]);

type NativeTaskOutput = {
  content: string;
  tasks: unknown[];
  isError: boolean;
};

type ThreadPolicyState = {
  lastSignature?: string;
  lastTasksKey?: string;
  lastOutput?: NativeTaskOutput;
  noProgressCount: number;
};

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function threadIdFromContext(context: unknown): string {
  if (!context || typeof context !== "object") return "unknown";
  const agent = (context as { agent?: { threadId?: unknown } }).agent;
  return typeof agent?.threadId === "string" && agent.threadId ? agent.threadId : "unknown";
}

function nativeTaskOutput(value: unknown): NativeTaskOutput | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.tasks)) return undefined;
  return {
    content: typeof record.content === "string" ? record.content : "Task state returned by Mastra.",
    tasks: record.tasks,
    isError: record.isError === true,
  };
}

/**
 * Guards only the agent/tool loop boundary. Task IDs, transitions, persistence,
 * and canonical results remain entirely owned by TaskSignalProvider.
 */
export class TaskToolPolicy {
  private readonly states = new Map<string, ThreadPolicyState>();

  readonly hooks: ToolHooks = {
    beforeToolCall: ({ toolName, input, context }) => {
      if (!TASK_TOOLS.has(toolName)) return;
      const threadId = threadIdFromContext(context);
      const state = this.states.get(threadId);
      const signature = `${toolName}:${stableValue(input)}`;
      if (!state?.lastOutput) return;
      if (state.lastSignature === signature)
        return {
          proceed: false,
          output: {
            ...state.lastOutput,
            content: "This exact task mutation already ran. Use the current task state and continue without repeating it.",
            isError: true,
          },
        };
      if (state.noProgressCount >= 3)
        return {
          proceed: false,
          output: {
            ...state.lastOutput,
            content: "Task tools made no progress repeatedly. Stop using task tools and answer the user with the current result.",
            isError: true,
          },
        };
    },
    afterToolCall: ({ toolName, input, output, context }) => {
      if (!TASK_TOOLS.has(toolName)) return;
      const parsed = nativeTaskOutput(output);
      if (!parsed) return;
      const threadId = threadIdFromContext(context);
      const previous = this.states.get(threadId);
      const tasksKey = stableValue(parsed.tasks);
      this.states.set(threadId, {
        lastSignature: `${toolName}:${stableValue(input)}`,
        lastTasksKey: tasksKey,
        lastOutput: parsed,
        noProgressCount: previous?.lastTasksKey === tasksKey ? previous.noProgressCount + 1 : 0,
      });
    },
  };

  reset(threadId?: string): void {
    if (threadId) this.states.delete(threadId);
    else this.states.clear();
  }
}
