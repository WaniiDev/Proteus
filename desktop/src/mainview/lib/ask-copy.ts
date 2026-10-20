import type { ChatToolPart, PendingInteraction } from "../../shared/contracts";
import { describeToolActivity, redactToolText } from "./tool-activity";

const MAX_CODE = 1_600;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

function clip(value: string): string {
  return value.length > MAX_CODE ? `${value.slice(0, MAX_CODE - 1).trimEnd()}…` : value;
}

/** The tool call an approval is about, shaped as a waiting tool part so the activity copy can name the change. */
function approvalTool(interaction: PendingInteraction): ChatToolPart {
  const name = interaction.toolName ?? "tool";
  return { type: "tool", id: interaction.id, toolCallId: interaction.toolCallId, name, label: name, status: "waiting", input: interaction.args };
}

/** The verb phrase of the change ("edit", "run", "use Web fetch") and its target. */
function change(interaction: PendingInteraction) {
  const descriptor = describeToolActivity(approvalTool(interaction));
  const base = descriptor.action.replace(/^Waiting (?:for approval )?to /, "");
  return { base, target: descriptor.target, groupKey: descriptor.groupKey };
}

/** "Edit docs/plan.md": names exactly what will happen. */
export function askTitle(interaction: PendingInteraction): string {
  if (interaction.kind !== "tool_approval" || interaction.status === "failed") return interaction.title;
  const { base, target } = change(interaction);
  return [capitalize(base), target].filter(Boolean).join(" ");
}

/** The kicker's subject: "Needs you · Edit file". */
export function askWhat(interaction: PendingInteraction): string {
  if (interaction.status === "failed") return "Recovery";
  if (interaction.kind === "submit_plan") return "Plan";
  if (interaction.kind === "ask_user") return "Question";
  const { base, groupKey } = change(interaction);
  return capitalize(groupKey.endsWith("_file") ? `${base} file` : base);
}

const APPROVE_NOUN: Record<string, string> = { edit_file: "edit", write_file: "write", delete: "delete", command: "command", mkdir: "folder", kill_process: "stop", forget_memory: "forget" };

/** "Approve edit": the yes names what it allows. */
export function approveLabel(interaction: PendingInteraction): string {
  const noun = APPROVE_NOUN[change(interaction).groupKey];
  return noun ? `Approve ${noun}` : "Approve";
}

const CONSEQUENCE: Record<string, string> = {
  edit_file: "Proteus will change this file in your workspace once you approve.",
  write_file: "Proteus will write this file in your workspace once you approve.",
  delete: "This removes it from your workspace.",
  command: "Proteus will run this command in your workspace.",
  mkdir: "Proteus will create this folder in your workspace.",
  kill_process: "This stops the running process.",
  forget_memory: "This removes the saved memory.",
};

/** One sentence of consequence under the title. */
export function askSentence(interaction: PendingInteraction): string | undefined {
  if (interaction.status === "failed") return interaction.error?.message ?? "The response could not be sent.";
  if (interaction.kind === "tool_approval") return CONSEQUENCE[change(interaction).groupKey] ?? interaction.question ?? "Proteus is ready to use this tool. Review the request before it continues.";
  return interaction.question;
}

/** The exact change, in mono: a command, a removed/added pair, the new file body, or the raw arguments. */
export function askCode(interaction: PendingInteraction): string | undefined {
  if (interaction.kind !== "tool_approval" || interaction.status === "failed") return undefined;
  const args = record(interaction.args);
  const command = text(args?.command);
  if (command) return clip(redactToolText(command));
  const removed = text(args?.old_string);
  const added = typeof args?.new_string === "string" ? args.new_string : undefined;
  if (removed !== undefined && added !== undefined) {
    return clip(redactToolText([...removed.split("\n").map((line) => `- ${line}`), ...added.split("\n").map((line) => `+ ${line}`)].join("\n")));
  }
  const content = text(args?.content);
  if (content) return clip(redactToolText(content));
  if (interaction.args === undefined || interaction.args === null) return undefined;
  try {
    return clip(redactToolText(JSON.stringify(interaction.args, null, 2)));
  } catch {
    return interaction.argsSummary;
  }
}

/** Open asks for the active thread, oldest first: one shows, the rest queue. Failed ones stay until dismissed or resubmitted. */
export function askQueue(interactions: PendingInteraction[], activeThreadId: string | null): PendingInteraction[] {
  return interactions
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (item.status === "pending" || item.status === "resolving" || item.status === "failed") && (!item.threadId || item.threadId === activeThreadId))
    .sort((left, right) => left.item.createdAt.localeCompare(right.item.createdAt) || left.index - right.index)
    .map(({ item }) => item);
}

export type ResolvedAsk = { id: string; label: string; title: string; tone: "ok" | "muted" };

/** Does this tool wait for the person? Derived from the activity copy, so the approval policy stays in one place. */
function needsApproval(tool: ChatToolPart): boolean {
  return describeToolActivity({ ...tool, status: "waiting" }).action.startsWith("Waiting for approval");
}

/**
 * The thread's record of an ask the person answered, derived only from what the snapshot carries: the tool part's final status.
 * Not derivable without runtime changes: a dismissed recovery, and whether a plan's feedback text was sent.
 */
export function resolvedAsk(tool: ChatToolPart): ResolvedAsk | null {
  if (tool.status === "waiting" || tool.status === "running" || tool.status === "streaming_input") return null;
  const descriptor = describeToolActivity(tool);
  if (tool.name === "submit_plan") {
    const title = descriptor.target ?? "Plan";
    if (tool.status === "completed") return { id: tool.toolCallId, label: "Approved", title, tone: "ok" };
    if (tool.status === "declined") return { id: tool.toolCallId, label: "Changes requested", title, tone: "muted" };
    return null;
  }
  if (tool.name === "ask_user") {
    const title = text(record(tool.input)?.question) ?? "Question";
    if (tool.status === "completed") return { id: tool.toolCallId, label: "Answered", title, tone: "ok" };
    if (tool.status === "declined" || tool.status === "cancelled") return { id: tool.toolCallId, label: "Cancelled", title, tone: "muted" };
    return null;
  }
  if (!needsApproval(tool)) return null;
  const named = [capitalize(describeToolActivity({ ...tool, status: "waiting" }).action.replace(/^Waiting for approval to /, "")), descriptor.target].filter(Boolean).join(" ");
  if (tool.status === "declined") return { id: tool.toolCallId, label: "Declined", title: named, tone: "muted" };
  if (tool.status === "completed" || tool.status === "error") return { id: tool.toolCallId, label: "Approved", title: named, tone: "ok" };
  return null;
}

export function resolvedAsks(tools: ChatToolPart[]): ResolvedAsk[] {
  return tools.map(resolvedAsk).filter((item): item is ResolvedAsk => item !== null);
}
