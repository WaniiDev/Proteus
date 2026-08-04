import type { ChatToolPart } from "../shared/contracts";

function toolStateLabel(status: ChatToolPart["status"]): string {
  return status.replaceAll("_", " ");
}

export function ToolTimeline({ tools, live, pendingIds }: { tools: ChatToolPart[]; live: boolean; pendingIds: Set<string> }) {
  const visible = tools.filter((tool) => !pendingIds.has(tool.toolCallId));
  if (!visible.length) return null;

  return (
    <section
      className={`tool-timeline${live ? " tool-timeline-live" : ""}`}
      aria-label={live ? "Tool activity" : "Tools used"}
      aria-live={live ? "polite" : "off"}
      aria-relevant="additions text"
    >
      <div className="tool-timeline-head">
        <span>{live ? "Using tools" : "Tools used"}</span>
        <small>{visible.length}</small>
      </div>
      <div className="tool-list">
        {visible.map((tool) => {
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
    </section>
  );
}
