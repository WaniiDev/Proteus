import type { ToolHooks } from "@mastra/core/tools";

const TASK_TOOLS = new Set(["task_write", "task_update", "task_complete", "task_check"]);
const TASK_MUTATION_TOOLS = new Set(["task_write", "task_update", "task_complete"]);

type NativeTaskOutput = {
  content: string;
  tasks: unknown[];
  isError: boolean;
  summary?: { allCompleted?: boolean };
};

type ThreadPolicyState = {
  lastSignature?: string;
  lastTasksKey?: string;
  lastOutput?: NativeTaskOutput;
  noProgressCount: number;
  forceTextOnly: boolean;
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
  const record = context as {
    agent?: { threadId?: unknown };
    requestContext?: { get?: (key: string) => unknown };
  };
  const controller = record.requestContext?.get?.("controller");
  const controllerThreadId = controller && typeof controller === "object" ? (controller as { threadId?: unknown }).threadId : undefined;
  if (typeof controllerThreadId === "string" && controllerThreadId) return controllerThreadId;
  return typeof record.agent?.threadId === "string" && record.agent.threadId ? record.agent.threadId : "unknown";
}

function nativeTaskOutput(value: unknown): NativeTaskOutput | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.tasks)) return undefined;
  return {
    content: typeof record.content === "string" ? record.content : "Task state returned by Mastra.",
    tasks: record.tasks,
    isError: record.isError === true,
    ...(record.summary && typeof record.summary === "object" ? { summary: record.summary as { allCompleted?: boolean } } : {}),
  };
}

type StepToolResult = {
  toolName?: unknown;
  output?: unknown;
  result?: unknown;
};

function taskResultsFromSteps(steps: unknown[]): Array<{ toolName: string; output: NativeTaskOutput }> {
  const results: Array<{ toolName: string; output: NativeTaskOutput }> = [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const toolResults = (step as { toolResults?: unknown }).toolResults;
    if (!Array.isArray(toolResults)) continue;
    for (const value of toolResults) {
      if (!value || typeof value !== "object") continue;
      const result = value as StepToolResult;
      if (typeof result.toolName !== "string" || !TASK_TOOLS.has(result.toolName)) continue;
      const output = nativeTaskOutput(result.output ?? result.result);
      if (output) results.push({ toolName: result.toolName, output });
    }
  }
  return results;
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
      if (state.forceTextOnly)
        return {
          proceed: false,
          output: {
            ...state.lastOutput,
            content: "Task tracking is already settled. Answer the user from the current task state.",
            isError: false,
          },
        };
      if (toolName === "task_check" && state.lastSignature === signature)
        return {
          proceed: false,
          output: {
            ...state.lastOutput,
            content: "Task progress was already checked. Continue from the current task state.",
            isError: false,
          },
        };
      if (!TASK_MUTATION_TOOLS.has(toolName)) return;
      if (state.lastSignature === signature)
        return {
          proceed: false,
          output: {
            ...state.lastOutput,
            content: "This task mutation is already applied. Continue from the current task state.",
            isError: false,
          },
        };
      if (state.noProgressCount >= 3)
        return {
          proceed: false,
          output: {
            ...state.lastOutput,
            content: "The task state is unchanged. Continue from the current task state without repeating this mutation.",
            isError: false,
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
      const noProgressCount = previous?.lastTasksKey === tasksKey ? previous.noProgressCount + 1 : 0;
      this.states.set(threadId, {
        lastSignature: `${toolName}:${stableValue(input)}`,
        lastTasksKey: tasksKey,
        lastOutput: parsed,
        noProgressCount,
        forceTextOnly:
          previous?.forceTextOnly === true ||
          (toolName === "task_check" && parsed.summary?.allCompleted === true && !parsed.isError) ||
          noProgressCount >= 3,
      });
    },
  };

  /**
   * Mastra calls prepareStep before every model step. Once the native completion
   * check succeeds, give the model one final text-only step instead of another
   * chance to call task_check. The unchanged-state fallback bounds other loops.
   */
  readonly prepareStep = ({ steps, messages }: { steps: unknown[]; messages?: unknown[] }): { toolChoice: "none" } | undefined => {
    const messageThreadId = [...(messages ?? [])].reverse().find((message) => message && typeof message === "object" && typeof (message as { threadId?: unknown }).threadId === "string") as { threadId?: string } | undefined;
    let runState = messageThreadId?.threadId ? this.states.get(messageThreadId.threadId) : undefined;
    const forcedStates = [...this.states.values()].filter((state) => state.forceTextOnly);
    if (!runState && forcedStates.length === 1) runState = forcedStates[0];
    if (runState?.forceTextOnly) return { toolChoice: "none" };
    const results = taskResultsFromSteps(steps);
    if (results.some(({ toolName, output }) => toolName === "task_check" && output.summary?.allCompleted === true && !output.isError)) return { toolChoice: "none" };
    const latest = results.slice(-3);
    if (latest.length === 3 && latest.every(({ output }) => stableValue(output.tasks) === stableValue(latest[0].output.tasks))) return { toolChoice: "none" };
    return undefined;
  };

  reset(threadId?: string): void {
    if (threadId) this.states.delete(threadId);
    else this.states.clear();
  }
}
