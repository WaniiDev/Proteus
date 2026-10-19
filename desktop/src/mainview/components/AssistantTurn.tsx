import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, WorkbenchTask } from "../../shared/contracts";
import { groupAssistantPartRuns } from "../lib/ui-helpers";
import { ToolTimeline } from "./ToolTimeline";
import { MessageActions } from "./MessageActions";
import { markdownComponents } from "./MarkdownCode";
import { WebSearchedSources } from "./WebSearchedSources";

export function AssistantTurn({ messages, parts, pendingIds, tasks, onRetry, onContinue }: { messages: ChatMessage[]; parts: ChatMessage["parts"]; pendingIds: Set<string>; tasks: WorkbenchTask[]; onRetry: (id: string) => void; onContinue: (id: string) => void }) {
  const terminal = messages.at(-1)!;
  const runs = groupAssistantPartRuns(parts);
  const sources = [...new Map(parts.filter((part): part is Extract<ChatMessage["parts"][number], { type: "source-url" }> => part.type === "source-url").map((source) => [source.url, source])).values()];
  const actionMessage = {
    ...terminal,
    text: parts.filter((part): part is Extract<ChatMessage["parts"][number], { type: "text" }> => part.type === "text").map((part) => part.text).join("\n\n"),
  };
  return (
    <div className={`msg ai message-${terminal.status}`}>
      <div className="msg-body">
        {runs.map((run) => run.type === "text" ? (
          <div className="msg-text markdown-body" key={run.part.id}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {run.part.text}
            </ReactMarkdown>
          </div>
        ) : (
          <ToolTimeline key={`tools:${run.tools.map((tool) => tool.toolCallId).join(":")}`} tools={run.tools} live={terminal.status === "streaming"} pendingIds={pendingIds} tasks={tasks} />
        ))}
        <WebSearchedSources sources={sources} />
        {(terminal.status === "interrupted" || terminal.status === "error") && <span className="message-status">{terminal.status === "interrupted" ? "Stopped" : "Response failed"}</span>}
        <MessageActions message={actionMessage} onRetry={terminal.status === "error" ? () => onRetry(terminal.id) : undefined} onContinue={terminal.status === "interrupted" ? () => onContinue(terminal.id) : undefined} />
      </div>
    </div>
  );
}
