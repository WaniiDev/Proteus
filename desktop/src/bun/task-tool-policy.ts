import type { ProcessInputStepArgs, ProcessInputStepResult } from "@mastra/core/processors";
import type { TaskItemSnapshot, ToolHooks } from "@mastra/core/tools";

const TASK_TOOLS = new Set(["task_write", "task_update", "task_complete", "task_check"]);
const TASK_MUTATION_TOOLS = new Set(["task_write", "task_update", "task_complete"]);
const RECENT_TASK_STATE_LIMIT = 6;
const BLOCKED_ATTEMPT_LIMIT = 2;

type NativeTaskOutput = {
  content: string;
  tasks: TaskItemSnapshot[];
  isError: boolean;
  summary?: { allCompleted?: boolean };
};

type ThreadPolicyState = {
  lastAttemptSignature?: string;
  lastTasksKey?: string;
  lastOutput?: NativeTaskOutput;
  lastResult?: NativeTaskOutput;
  blockedAttempts: number;
  forceTextOnly: boolean;
  recentTasksKeys: string[];
  maxCompletedCount: number;
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

function nativeTask(value: unknown): TaskItemSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const task = value as Record<string, unknown>;
  if (typeof task.id !== "string" || typeof task.content !== "string" || typeof task.activeForm !== "string") return undefined;
  if (task.status !== "pending" && task.status !== "in_progress" && task.status !== "completed") return undefined;
  return { id: task.id, content: task.content, activeForm: task.activeForm, status: task.status };
}

function nativeTaskOutput(value: unknown): NativeTaskOutput | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.tasks)) return undefined;
  const tasks = record.tasks.map(nativeTask);
  if (tasks.some((task) => !task)) return undefined;
  return {
    content: typeof record.content === "string" ? record.content : "Task state returned by Mastra.",
    tasks: tasks as TaskItemSnapshot[],
    isError: record.isError === true,
    ...(record.summary && typeof record.summary === "object" ? { summary: record.summary as { allCompleted?: boolean } } : {}),
  };
}

function completedCount(tasks: TaskItemSnapshot[]): number {
  return tasks.filter((task) => task.status === "completed").length;
}

function taskInput(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function currentTask(state: ThreadPolicyState, id: unknown): TaskItemSnapshot | undefined {
  if (typeof id !== "string") return undefined;
  return (state.lastOutput ?? state.lastResult)?.tasks.find((task) => task.id === id);
}

function updateAlreadyApplied(task: TaskItemSnapshot, input: Record<string, unknown>): boolean {
  const changes = (["content", "status", "activeForm"] as const).filter((key) => input[key] !== undefined);
  return changes.length > 0 && changes.every((key) => task[key] === input[key]);
}

function nextTaskGuidance(tasks: TaskItemSnapshot[]): string {
  const next = tasks.find((task) => task.status === "in_progress") ?? tasks.find((task) => task.status === "pending");
  return next
    ? `Next incomplete task: ${next.id} (${next.status}). Continue from that stable ID.`
    : "All tracked tasks are complete. Check completion once if needed, then answer the user.";
}

function correctionOutput(state: ThreadPolicyState, reason: string): NativeTaskOutput | undefined {
  const source = state.lastOutput ?? state.lastResult;
  if (!source) return undefined;
  return {
    ...source,
    content: `${reason} Current task state is unchanged. ${nextTaskGuidance(source.tasks)}`,
    isError: false,
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

function rejectionReason(toolName: string, input: unknown, state: ThreadPolicyState): string | undefined {
  const record = taskInput(input);
  const signature = `${toolName}:${stableValue(input)}`;
  if (toolName === "task_check" && state.lastAttemptSignature === signature) return "Task progress was already checked.";
  if (TASK_MUTATION_TOOLS.has(toolName) && state.lastAttemptSignature === signature) return "This task mutation was already attempted.";

  const task = currentTask(state, record.id);
  if (toolName === "task_complete" && task?.status === "completed") return `Task ${task.id} is already completed.`;
  if (toolName !== "task_update" || !task) return undefined;
  if (task.status === "completed" && (record.status === "pending" || record.status === "in_progress"))
    return `Task ${task.id} is already completed and cannot be reopened with task_update; use task_write only for an explicit replan.`;
  if (updateAlreadyApplied(task, record)) return `The requested state already holds for task ${task.id}.`;
  return undefined;
}

/**
 * Guards only the documented Mastra agent/tool-loop boundary. Task IDs,
 * persistence, mutations, and canonical results remain owned by
 * TaskSignalProvider; this policy keeps one task-list revision monotonic and
 * bounds model retries around the native tools.
 */
export class TaskToolPolicy {
  private readonly states = new Map<string, ThreadPolicyState>();

  readonly hooks: ToolHooks = {
    beforeToolCall: ({ toolName, input, context }) => {
      if (!TASK_TOOLS.has(toolName)) return;
      const threadId = threadIdFromContext(context);
      const state = this.states.get(threadId);
      if (!state) return;
      if (state.forceTextOnly) {
        const output = correctionOutput(state, "Task tracking is already settled.");
        return output ? { proceed: false, output } : undefined;
      }

      const reason = rejectionReason(toolName, input, state);
      if (!reason) return;
      const blockedAttempts = state.blockedAttempts + 1;
      state.blockedAttempts = blockedAttempts;
      state.lastAttemptSignature = `${toolName}:${stableValue(input)}`;
      state.forceTextOnly = blockedAttempts >= BLOCKED_ATTEMPT_LIMIT;
      const output = correctionOutput(state, reason);
      return output ? { proceed: false, output } : undefined;
    },
    afterToolCall: ({ toolName, input, output, context }) => {
      if (!TASK_TOOLS.has(toolName)) return;
      const parsed = nativeTaskOutput(output);
      if (!parsed) return;
      const threadId = threadIdFromContext(context);
      const previous = this.states.get(threadId);
      const signature = `${toolName}:${stableValue(input)}`;

      if (parsed.isError) {
        const blockedAttempts = (previous?.blockedAttempts ?? 0) + 1;
        this.states.set(threadId, {
          lastAttemptSignature: signature,
          lastTasksKey: previous?.lastTasksKey,
          lastOutput: previous?.lastOutput,
          lastResult: parsed,
          blockedAttempts,
          forceTextOnly: previous?.forceTextOnly === true || blockedAttempts >= BLOCKED_ATTEMPT_LIMIT,
          recentTasksKeys: previous?.recentTasksKeys ?? [],
          maxCompletedCount: previous?.maxCompletedCount ?? 0,
        });
        return;
      }

      const tasksKey = stableValue(parsed.tasks);
      const progress = previous?.lastTasksKey !== tasksKey;
      const completed = completedCount(parsed.tasks);
      const cycle = progress && previous?.recentTasksKeys.includes(tasksKey) === true && completed <= previous.maxCompletedCount;
      const blockedAttempts = progress ? 0 : (previous?.blockedAttempts ?? 0) + 1;
      const recentTasksKeys = progress
        ? [...(previous?.recentTasksKeys ?? []), tasksKey].slice(-RECENT_TASK_STATE_LIMIT)
        : (previous?.recentTasksKeys ?? [tasksKey]);
      this.states.set(threadId, {
        lastAttemptSignature: signature,
        lastTasksKey: tasksKey,
        lastOutput: parsed,
        lastResult: parsed,
        blockedAttempts,
        forceTextOnly:
          previous?.forceTextOnly === true ||
          (toolName === "task_check" && parsed.summary?.allCompleted === true) ||
          cycle ||
          blockedAttempts >= BLOCKED_ATTEMPT_LIMIT,
        recentTasksKeys,
        maxCompletedCount: Math.max(previous?.maxCompletedCount ?? 0, completed),
      });
    },
  };

  /** Give Mastra one final text-only step after completion or a bounded loop. */
  readonly prepareStep = (args: ProcessInputStepArgs): ProcessInputStepResult | undefined => {
    const runState = this.states.get(threadIdFromContext(args));
    if (runState?.forceTextOnly) return { toolChoice: "none" };
    const results = taskResultsFromSteps(args.steps);
    if (results.some(({ toolName, output }) => toolName === "task_check" && output.summary?.allCompleted === true && !output.isError))
      return { toolChoice: "none" };
    return undefined;
  };

  reset(threadId?: string): void {
    if (threadId) this.states.delete(threadId);
    else this.states.clear();
  }
}
