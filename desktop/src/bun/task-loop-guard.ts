import { BaseProcessor, type ProcessInputStepArgs, type ProcessInputStepResult, type ProcessOutputStepArgs } from "@mastra/core/processors";
import { MASTRA_THREAD_ID_KEY } from "@mastra/core/request-context";
import { assignTaskIds, type TaskItem, type TaskItemInput } from "@mastra/core/signals";

export const TASK_LOOP_STEP_LIMIT = 32;

const TASK_TOOL_NAMES = new Set(["task_write", "task_update", "task_complete", "task_check"]);
const TASK_MUTATION_NAMES = new Set(["task_write", "task_update", "task_complete"]);

type TaskStatus = TaskItem["status"];
type TaskLoader = (args: ProcessOutputStepArgs) => Promise<TaskItem[] | undefined>;
type GuardState = Record<string, unknown> & {
  consecutiveViolations?: number;
  forceTextResponse?: boolean;
  lastCheckFingerprint?: string;
};

export type TaskToolCall = { toolName: string; args: unknown };
export type TaskCallAssessment =
  | { allowed: true; checkFingerprint?: string }
  | { allowed: false; reason: string; toolName?: string; taskId?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === "pending" || value === "in_progress" || value === "completed";
}

function isTaskItemInput(value: unknown): value is TaskItemInput {
  if (!isRecord(value)) return false;
  return (value.id === undefined || typeof value.id === "string")
    && typeof value.content === "string" && value.content.length > 0
    && isTaskStatus(value.status)
    && typeof value.activeForm === "string" && value.activeForm.length > 0;
}

export function taskListFingerprint(tasks: TaskItem[]): string {
  return JSON.stringify(tasks.map(({ id, content, status, activeForm }) => [id, content, status, activeForm]));
}

function sameTaskLists(left: TaskItem[], right: TaskItem[]): boolean {
  return taskListFingerprint(left) === taskListFingerprint(right);
}

function updateTask(tasks: TaskItem[], taskIndex: number, args: Record<string, unknown>): TaskItem[] {
  const updated = tasks.map((task, index) => index === taskIndex
    ? {
        ...task,
        ...(typeof args.content === "string" ? { content: args.content } : {}),
        ...(isTaskStatus(args.status) ? { status: args.status } : {}),
        ...(typeof args.activeForm === "string" ? { activeForm: args.activeForm } : {}),
      }
    : task);
  const inProgress = updated.reduce<number[]>((indices, task, index) => {
    if (task.status === "in_progress") indices.push(index);
    return indices;
  }, []);
  if (inProgress.length <= 1) return updated;
  const keepIndex = inProgress.includes(taskIndex) ? taskIndex : inProgress[inProgress.length - 1]!;
  return updated.map((task, index) => task.status === "in_progress" && index !== keepIndex ? { ...task, status: "pending" } : task);
}

function assessWrite(args: unknown, tasks: TaskItem[]): TaskCallAssessment {
  if (!isRecord(args) || !Array.isArray(args.tasks) || !args.tasks.every(isTaskItemInput)) {
    return { allowed: false, toolName: "task_write", reason: "task_write must provide one complete, valid task list." };
  }
  const nextTasks = assignTaskIds(args.tasks, tasks);
  if (nextTasks.filter((task) => task.status === "in_progress").length > 1) {
    return { allowed: false, toolName: "task_write", reason: "Only one task may be in_progress at a time." };
  }
  if (sameTaskLists(nextTasks, tasks)) {
    return { allowed: false, toolName: "task_write", reason: "task_write would recreate the current task list without changing progress." };
  }
  return { allowed: true };
}

function assessUpdate(args: unknown, tasks: TaskItem[]): TaskCallAssessment {
  if (!isRecord(args) || typeof args.id !== "string") {
    return { allowed: false, toolName: "task_update", reason: "task_update requires a stable task ID." };
  }
  const taskIndex = tasks.findIndex((task) => task.id === args.id);
  if (taskIndex < 0) return { allowed: false, toolName: "task_update", taskId: args.id, reason: `Task ${args.id} does not exist in the current task list.` };
  const hasContent = typeof args.content === "string" && args.content.length > 0;
  const hasStatus = isTaskStatus(args.status);
  const hasActiveForm = typeof args.activeForm === "string" && args.activeForm.length > 0;
  if (!hasContent && !hasStatus && !hasActiveForm) {
    return { allowed: false, toolName: "task_update", taskId: args.id, reason: `task_update for ${args.id} does not contain a valid changed field.` };
  }
  if (sameTaskLists(updateTask(tasks, taskIndex, args), tasks)) {
    return { allowed: false, toolName: "task_update", taskId: args.id, reason: `Task ${args.id} already has the requested values.` };
  }
  return { allowed: true };
}

function assessComplete(args: unknown, tasks: TaskItem[]): TaskCallAssessment {
  if (!isRecord(args) || typeof args.id !== "string") {
    return { allowed: false, toolName: "task_complete", reason: "task_complete requires a stable task ID." };
  }
  const task = tasks.find((candidate) => candidate.id === args.id);
  if (!task) return { allowed: false, toolName: "task_complete", taskId: args.id, reason: `Task ${args.id} does not exist in the current task list.` };
  if (task.status === "completed") return { allowed: false, toolName: "task_complete", taskId: args.id, reason: `Task ${args.id} is already completed.` };
  return { allowed: true };
}

export function assessTaskToolCalls(calls: TaskToolCall[], tasks: TaskItem[] | undefined, lastCheckFingerprint?: string): TaskCallAssessment {
  const taskCalls = calls.filter((call) => TASK_TOOL_NAMES.has(call.toolName));
  if (taskCalls.length === 0) return { allowed: true };
  if (taskCalls.length > 1) return { allowed: false, reason: "Call only one task tool per model step so task-state writes cannot race." };
  if (!tasks) return { allowed: true };

  const call = taskCalls[0]!;
  if (call.toolName === "task_write") return assessWrite(call.args, tasks);
  if (call.toolName === "task_update") return assessUpdate(call.args, tasks);
  if (call.toolName === "task_complete") return assessComplete(call.args, tasks);

  const fingerprint = taskListFingerprint(tasks);
  if (lastCheckFingerprint === fingerprint) return { allowed: false, toolName: "task_check", reason: "task_check already inspected this unchanged task state." };
  return { allowed: true, checkFingerprint: fingerprint };
}

function taskStateSummary(tasks: TaskItem[] | undefined): string {
  if (!tasks) return "The authoritative task snapshot is temporarily unavailable.";
  if (tasks.length === 0) return "No tasks are currently tracked.";
  const completed = tasks.filter((task) => task.status === "completed").length;
  const current = tasks.find((task) => task.status === "in_progress") ?? tasks.find((task) => task.status === "pending");
  return `${completed}/${tasks.length} tasks are completed.${current ? ` The next incomplete task is ${current.id} (${current.content}).` : " All tasks are complete."}`;
}

export class TaskLoopGuardProcessor extends BaseProcessor<"task-loop-guard"> {
  readonly id = "task-loop-guard" as const;

  constructor(private readonly loadTasksOverride?: TaskLoader) {
    super();
  }

  private async loadTasks(args: ProcessOutputStepArgs): Promise<TaskItem[] | undefined> {
    if (this.loadTasksOverride) return this.loadTasksOverride(args);
    const threadId = args.requestContext?.get(MASTRA_THREAD_ID_KEY);
    if (typeof threadId !== "string" || !threadId) return undefined;
    const storage = await this.mastra?.getStorage();
    const store = await storage?.getStore("threadState");
    const value = await store?.getState({ threadId, type: "task" });
    return Array.isArray(value) && value.every((task) => isRecord(task)
      && typeof task.id === "string" && typeof task.content === "string"
      && isTaskStatus(task.status) && typeof task.activeForm === "string")
      ? value as TaskItem[]
      : undefined;
  }

  processInputStep({ stepNumber, state, systemMessages }: ProcessInputStepArgs): ProcessInputStepResult {
    const guardState = state as GuardState;
    const forcedByLoop = guardState.forceTextResponse === true;
    if (!forcedByLoop && stepNumber < TASK_LOOP_STEP_LIMIT) return {};

    guardState.forceTextResponse = false;
    guardState.consecutiveViolations = 0;
    const reason = forcedByLoop
      ? "Task tracking repeated without progress. Do not call any tool in this step. Return control to the user with a concise progress summary and name the next incomplete task."
      : `This turn reached the ${TASK_LOOP_STEP_LIMIT}-step safety limit. Do not call any tool in this step. Return a concise progress summary and name the next incomplete task.`;
    return { toolChoice: "none", systemMessages: [...systemMessages, { role: "system", content: reason }] };
  }

  async processOutputStep(args: ProcessOutputStepArgs) {
    const calls = (args.toolCalls ?? []).map(({ toolName, args: callArgs }) => ({ toolName, args: callArgs }));
    const taskCalls = calls.filter((call) => TASK_TOOL_NAMES.has(call.toolName));
    const guardState = args.state as GuardState;
    if (taskCalls.length === 0) {
      guardState.consecutiveViolations = 0;
      return args.messageList;
    }

    const tasks = await this.loadTasks(args);
    const assessment = assessTaskToolCalls(taskCalls, tasks, guardState.lastCheckFingerprint);
    if (assessment.allowed) {
      guardState.consecutiveViolations = 0;
      if (assessment.checkFingerprint) guardState.lastCheckFingerprint = assessment.checkFingerprint;
      if (taskCalls.some((call) => TASK_MUTATION_NAMES.has(call.toolName))) guardState.lastCheckFingerprint = undefined;
      return args.messageList;
    }

    const violationCount = (guardState.consecutiveViolations ?? 0) + 1;
    guardState.consecutiveViolations = violationCount;
    if (violationCount >= 2) guardState.forceTextResponse = true;
    const reason = `${assessment.reason} ${taskStateSummary(tasks)} ${violationCount >= 2 ? "Stop using task tools and return a progress summary." : "Use the latest snapshot and choose one valid next action."}`;
    args.abort(reason, {
      retry: true,
      metadata: { category: "task-loop", violationCount, toolName: assessment.toolName, taskId: assessment.taskId },
    });
  }
}
