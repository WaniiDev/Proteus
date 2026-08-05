import type { ChatToolPart } from "../shared/contracts";

const INLINE_TOOL_LIMIT = 3;

function toolStateLabel(status: ChatToolPart["status"]): string {
  return status.replaceAll("_", " ");
}

export type ToolCallGroup = {
  name: string;
  label: string;
  count: number;
};

export function groupRepeatedToolCalls(tools: ChatToolPart[]): ToolCallGroup[] {
  const groups: ToolCallGroup[] = [];
  const byName = new Map<string, ToolCallGroup>();
  for (const tool of tools) {
    const existing = byName.get(tool.name);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const group = { name: tool.name, label: tool.label, count: 1 };
    groups.push(group);
    byName.set(tool.name, group);
  }
  return groups;
}

export function shouldCollapseToolCalls(tools: ChatToolPart[]): boolean {
  if (tools.length <= INLINE_TOOL_LIMIT) return false;
  return groupRepeatedToolCalls(tools).some((group) => group.count > 1);
}

function ToolRows({ tools }: { tools: ChatToolPart[] }) {
  return (
    <div className="tool-list">
      {tools.map((tool) => {
        const state = toolStateLabel(tool.status);
        return (
          <article className={`tool-row tool-${tool.status}`} key={tool.toolCallId}>
            <span className="tool-status-dot" aria-hidden="true" />
            <span className="tool-row-copy">
              <b>{tool.label}</b>
              <small>{tool.error || tool.outputSummary || tool.inputSummary || state}</small>
            </span>
            <span className="tool-state">{state}</span>
          </article>
        );
      })}
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

export function ToolTimeline({ tools, live, pendingIds }: { tools: ChatToolPart[]; live: boolean; pendingIds: Set<string> }) {
  const visible = tools.filter((tool) => !pendingIds.has(tool.toolCallId));
  if (!visible.length) return null;

  const groups = groupRepeatedToolCalls(visible);
  const collapsible = shouldCollapseToolCalls(visible);
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
              {groups.map((group) => (
                <span className="tool-group-label" key={group.name}>
                  {group.label}{group.count > 1 && <small>×{group.count}</small>}
                </span>
              ))}
            </span>
            <span className="tool-disclosure-chevron" aria-hidden="true" />
          </summary>
          <ToolRows tools={visible} />
        </details>
      ) : (
        <>
          <TimelineHeading live={live} count={visible.length} />
          <ToolRows tools={visible} />
        </>
      )}
    </section>
  );
}
