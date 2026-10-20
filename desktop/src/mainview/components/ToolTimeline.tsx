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

// Running and done share one grid cell, so "Reading" fades into "Read" without the row changing size.
function Verb({ tool, activity }: DescribedTool) {
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

function Steps({ tools }: { tools: DescribedTool[] }) {
  return (
    <>
      {tools.map(({ tool, activity }) => (
        <div className={`step step-${tool.status}`} key={tool.toolCallId}>
          <span className={`step-mark ${markFor(tool.status)}`} role="img" aria-label={activity.statusLabel} />
          <span className="step-copy">
            <Verb tool={tool} activity={activity} />
            {activity.target && (
              <>
                {" "}
                <code className="step-target" title={activity.fullTarget ?? activity.target}>{activity.target}</code>
              </>
            )}
            {activity.outcome && <span className="step-note"> · {activity.outcome}</span>}
          </span>
        </div>
      ))}
    </>
  );
}

export function ToolTimeline({ tools, live, pendingIds, tasks = [] }: { tools: ChatToolPart[]; live: boolean; pendingIds: Set<string>; tasks?: WorkbenchTask[] }) {
  const [open, setOpen] = useState(false);
  const visible = tools.filter((tool) => !pendingIds.has(tool.toolCallId));
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
    <section className="steps" aria-label="Steps" aria-live={live ? "polite" : "off"} aria-relevant="additions text">
      {collapsible && (
        <button type="button" className="step-group" aria-expanded={expanded} onClick={() => setOpen((value) => !value)}>
          <ChevronRight className="step-group-chevron" size={14} aria-hidden="true" />
          <span className="step-group-copy">{summary}</span>
        </button>
      )}
      {expanded && <Steps tools={described} />}
    </section>
  );
}
