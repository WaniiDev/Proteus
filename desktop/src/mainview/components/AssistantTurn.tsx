import { Fragment } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, WorkbenchTask } from "../../shared/contracts";
import { resolvedAsks } from "../lib/ask-copy";
import { groupAssistantPartRuns } from "../lib/ui-helpers";
import { AnswerCard, type AnswerIntentEvent } from "./answer";
import { ToolTimeline } from "./ToolTimeline";
import { MessageActions } from "./MessageActions";
import { markdownComponents } from "./MarkdownCode";
import { WebSearchedSources } from "./WebSearchedSources";
import { ResolvedLine, StoppedNote } from "./ResolvedLine";

export function AssistantTurn({ messages, parts, pendingIds, tasks, onRetry, onContinue, openAnswerId = null, onIntent, onFollowUp }: { messages: ChatMessage[]; parts: ChatMessage["parts"]; pendingIds: Set<string>; tasks: WorkbenchTask[]; onRetry: (id: string) => void; onContinue: (id: string) => void; /** The answer still open in the Island; it settles into the thread as a card once dismissed. */ openAnswerId?: string | null; onIntent?: (event: AnswerIntentEvent) => void; onFollowUp?: (text: string) => void }) {
  const terminal = messages.at(-1)!;
  const runs = groupAssistantPartRuns(parts);
  const sources = [...new Map(parts.filter((part): part is Extract<ChatMessage["parts"][number], { type: "source-url" }> => part.type === "source-url").map((source) => [source.url, source])).values()];
  const actionMessage = {
    ...terminal,
    text: parts.filter((part): part is Extract<ChatMessage["parts"][number], { type: "text" }> => part.type === "text").map((part) => part.text).join("\n\n"),
  };
  return (
    <div className={`turn-ai message-${terminal.status}`}>
      {runs.map((run) => run.type === "text" ? (
        <div className="reply" key={run.part.id}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {run.part.text}
          </ReactMarkdown>
        </div>
      ) : run.type === "answer" ? (
        run.part.answerId === openAnswerId ? null : <AnswerCard key={run.part.id} answer={run.part} onIntent={onIntent} onFollowUp={onFollowUp} />
      ) : (
        <Fragment key={`tools:${run.tools.map((tool) => tool.toolCallId).join(":")}`}>
          <ToolTimeline tools={run.tools} live={terminal.status === "streaming"} pendingIds={pendingIds} tasks={tasks} />
          {resolvedAsks(run.tools).map((ask) => <ResolvedLine key={ask.id} label={ask.label} title={ask.title} tone={ask.tone} />)}
        </Fragment>
      ))}
      <WebSearchedSources sources={sources} />
      {terminal.status === "interrupted" && <StoppedNote />}
      {terminal.status === "error" && <ResolvedLine label="Failed" title="Response did not finish" tone="muted" />}
      <MessageActions message={actionMessage} onRetry={terminal.status === "error" ? () => onRetry(terminal.id) : undefined} onContinue={terminal.status === "interrupted" ? () => onContinue(terminal.id) : undefined} />
    </div>
  );
}
