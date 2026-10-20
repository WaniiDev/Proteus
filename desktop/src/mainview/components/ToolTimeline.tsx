import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ChatToolPart, WorkbenchTask } from "../../shared/contracts";
import { describeToolActivity, pluralizeCount, type ToolActivityDescriptor } from "../lib/tool-activity";

const INLINE_TOOL_LIMIT = 3;
const COLLAPSED_GROUP_LIMIT = 3;

type DescribedTool = {
  tool: ChatToolPart;
  activity: ToolActivityDescriptor;
};

export type ToolCallGroup = {
  key: string;
  label: string;
  countNoun: string;
  count: number;
};

function describeTools(tools: ChatToolPart[], tasks: WorkbenchTask[] = []): DescribedTool[] {
  return tools.map((tool) => ({ tool, activity: describeToolActivity(tool, { tasks }) }));
}

export function groupRepeatedToolCalls(tools: ChatToolPart[], tasks: WorkbenchTask[] = []): ToolCallGroup[] {
  const groups: ToolCallGroup[] = [];
  const byKey = new Map<string, ToolCallGroup>();
  for (const { activity } of describeTools(tools, tasks)) {
    const existing = byKey.get(activity.groupKey);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const group = { key: activity.groupKey, label: activity.groupLabel, countNoun: activity.countNoun, count: 1 };
    groups.push(group);
    byKey.set(activity.groupKey, group);
  }
  return groups;
}

export function shouldCollapseToolCalls(tools: ChatToolPart[], tasks: WorkbenchTask[] = []): boolean {
  if (tools.length <= INLINE_TOOL_LIMIT) return false;
  return groupRepeatedToolCalls(tools, tasks).some((group) => group.count > 1);
}

function markFor(status: ChatToolPart["status"]): string {
  switch (status) {
    case "streaming_input":
    case "running":
      return "run";
    case "completed":
      return "done";
    case "waiting":
      return "wait";
    case "error":
      return "no error";
    case "declined":
    case "cancelled":
      return "no";
  }
}

/** A tool still "running" in a list that is no longer live was cut off: it reads as stopped, not as a spinner that never ends. */
function isStopped(tool: ChatToolPart, live: boolean): boolean {
  return !live && (tool.status === "streaming_input" || tool.status === "running");
}

// Running and done swap in one cell sized to the visible verb; the leaving one overlays it and fades, so "Read docs/plan.md" has no gap.
function Verb({ tool, activity, stopped, waiting }: DescribedTool & { stopped: boolean; waiting: boolean }) {
  if (stopped) return <span className="step-verb">{activity.verbs.ongoing}</span>;
  if (waiting) return <span className="step-verb">{activity.action.replace(/^Waiting (?:for approval )?to /, "").replace(/^\w/, (letter) => letter.toLocaleUpperCase())}</span>;
  const swaps = tool.status === "streaming_input" || tool.status === "running" || tool.status === "completed";
  if (!swaps) return <span className="step-verb">{activity.action}</span>;
  const done = tool.status === "completed";
  return (
    <span className="step-verb step-verb-swap">
      <span data-on={!done} aria-hidden={done || undefined}>{activity.verbs.ongoing}</span>
      <span data-on={done} aria-hidden={!done || undefined}>{activity.verbs.past}</span>
    </span>
  );
}

function Steps({ tools, live }: { tools: DescribedTool[]; live: boolean }) {
  return (
    <>
      {tools.map(({ tool, activity }) => {
        const stopped = isStopped(tool, live);
        const waiting = tool.status === "waiting";
        const note = stopped ? "stopped" : waiting ? "waiting for you" : activity.outcome;
        return (
          <div className={`step step-${stopped ? "cancelled" : tool.status}`} key={tool.toolCallId}>
            <span className={`step-mark ${stopped ? "no" : markFor(tool.status)}`} role="img" aria-label={stopped ? "Stopped" : activity.statusLabel} />
            <span className="step-copy">
              <Verb tool={tool} activity={activity} stopped={stopped} waiting={waiting} />
              {activity.target && (
                <>
                  {" "}
                  <code className="step-target" title={activity.fullTarget ?? activity.target}>{activity.target}</code>
                </>
              )}
              {note && <span className="step-note"> · {note}</span>}
            </span>
          </div>
        );
      })}
    </>
  );
}

/** The tools whose card lives in the Island's body and is recorded as a resolved line afterwards; they never appear as steps. */
const ASK_TOOLS = new Set(["ask_user", "submit_plan"]);

export function ToolTimeline({ tools, live, pendingIds, tasks = [] }: { tools: ChatToolPart[]; live: boolean; pendingIds: Set<string>; tasks?: WorkbenchTask[] }) {
  const [open, setOpen] = useState(false);
  // An approval that is waiting stays in the list as its own row ("Edit docs/plan.md · waiting for you"); questions and plans live in the Island only.
  const visible = tools.filter((tool) => !(pendingIds.has(tool.toolCallId) && ASK_TOOLS.has(tool.name)));
  if (!visible.length) return null;

  const described = describeTools(visible, tasks);
  const groups = groupRepeatedToolCalls(visible, tasks);
  const summaryGroups = groups.slice(0, COLLAPSED_GROUP_LIMIT);
  const remainingGroupCount = groups.length - summaryGroups.length;
  const requiresAttention = visible.some((tool) => tool.status !== "completed");
  // A live list is never collapsed, and neither is one that still needs the person.
  const collapsible = shouldCollapseToolCalls(visible, tasks) && !live && !requiresAttention;
  const expanded = !collapsible || open;

  const summary = [
    ...summaryGroups.map((group) => `${group.label} ${group.count} ${pluralizeCount(group.countNoun, group.count)}`),
    ...(remainingGroupCount > 0 ? [`+${remainingGroupCount} more`] : []),
  ].join(" · ");

  return (
    <section className="steps" aria-label="Steps">
      {collapsible && (
        <button type="button" className="step-group" aria-expanded={expanded} onClick={() => setOpen((value) => !value)}>
          <ChevronRight className="step-group-chevron" size={14} aria-hidden="true" />
          <span className="step-group-copy">{summary}</span>
        </button>
      )}
      {expanded && <Steps tools={described} live={live} />}
    </section>
  );
}
