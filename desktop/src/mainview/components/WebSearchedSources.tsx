import { Search } from "lucide-react";
import type { ChatMessage } from "../../shared/contracts";
import { SourcePill } from "./SourcePill";

export function WebSearchedSources({ sources }: { sources: Extract<ChatMessage["parts"][number], { type: "source-url" }>[] }) {
  if (sources.length === 0) return null;
  return (
    <nav className="message-sources" aria-label="Web search citations">
      <div className="message-sources-header">
        <Search className="sources-header-icon" />
        <span>Web Searched</span>
      </div>
      <div className="message-sources-pills">
        {sources.map((source, index) => (
          <SourcePill key={source.url} source={source} index={index} />
        ))}
      </div>
    </nav>
  );
}
