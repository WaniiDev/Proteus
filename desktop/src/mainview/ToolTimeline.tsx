import type { ChatToolPart, WorkbenchTask } from "../shared/contracts";
import { describeToolActivity, pluralizeCount, rawToolActivity, type ToolActivityDescriptor } from "./tool-activity";

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

function RawToolDetails({ tool }: { tool: ChatToolPart }) {
  return (
    <details className="tool-raw-disclosure">
      <summary>Raw details</summary>
      <pre>{JSON.stringify(rawToolActivity(tool), null, 2)}</pre>
    </details>
  );
}

function ToolRows({ tools }: { tools: DescribedTool[] }) {
  return (
    <div className="tool-list">
      {tools.map(({ tool, activity }) => (
        <details className={`tool-row-disclosure tool-${tool.status}`} key={tool.toolCallId}>
          <summary className="tool-row" aria-label={`${activity.title}. ${activity.statusLabel}`}>
            <span className="tool-status-dot" aria-hidden="true" />
            <span className="tool-row-copy">
              <span className="tool-row-title">
                <span className="tool-action">{activity.action}</span>
                {activity.target && (
                  <code className="tool-target" title={activity.fullTarget ?? activity.target}>{activity.target}</code>
                )}
              </span>
              {activity.outcome && <small>{activity.outcome}</small>}
            </span>
          </summary>
          <div className="tool-row-details">
            {activity.details.length > 0 && (
              <dl>
                {activity.details.map((item) => (
                  <div key={`${tool.toolCallId}:${item.label}`}>
                    <dt>{item.label}</dt>
                    <dd className={item.mono ? "mono" : undefined}>{item.value}</dd>
                  </div>
                ))}
                {activity.outcome && (
                  <div>
                    <dt>Result</dt>
                    <dd>{activity.outcome}</dd>
                  </div>
                )}
              </dl>
            )}
            <RawToolDetails tool={tool} />
          </div>
        </details>
      ))}
    </div>
  );
}

function TimelineHeading({ live, count }: { live: boolean; count: number }) {
  return (
    <span className="tool-timeline-head">
      <span>{live ? "Using tools" : "Tools used"}</span>
      <small>{count}</small>
    </span>
  );
}

export function ToolTimeline({ tools, live, pendingIds, tasks = [] }: { tools: ChatToolPart[]; live: boolean; pendingIds: Set<string>; tasks?: WorkbenchTask[] }) {
  const visible = tools.filter((tool) => !pendingIds.has(tool.toolCallId));
  if (!visible.length) return null;

  const described = describeTools(visible, tasks);
  const groups = groupRepeatedToolCalls(visible, tasks);
  const summaryGroups = groups.slice(0, COLLAPSED_GROUP_LIMIT);
  const remainingGroupCount = groups.length - summaryGroups.length;
  const collapsible = shouldCollapseToolCalls(visible, tasks);
  const requiresAttention = visible.some((tool) => tool.status !== "completed");

  return (
    <section
      className={`tool-timeline${live ? " tool-timeline-live" : ""}`}
      aria-label={live ? "Tool activity" : "Tools used"}
      aria-live={live ? "polite" : "off"}
      aria-relevant="additions text"
    >
      {collapsible ? (
        <details className="tool-timeline-disclosure" open={live || requiresAttention || undefined}>
          <summary>
            <TimelineHeading live={live} count={visible.length} />
            <span className="tool-group-summary">
              {summaryGroups.map((group) => (
                <span className="tool-group-label" key={group.key}>
                  {group.label} {group.count} {pluralizeCount(group.countNoun, group.count)}
                </span>
              ))}
              {remainingGroupCount > 0 && <span className="tool-group-label tool-group-overflow">+{remainingGroupCount} more</span>}
            </span>
            <span className="tool-disclosure-chevron" aria-hidden="true" />
          </summary>
          <ToolRows tools={described} />
        </details>
      ) : (
        <ToolRows tools={described} />
      )}
    </section>
  );
}
