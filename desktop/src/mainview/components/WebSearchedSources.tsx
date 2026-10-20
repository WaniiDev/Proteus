import type { ChatMessage } from "../../shared/contracts";
import { SourcePill } from "./SourcePill";

export function WebSearchedSources({ sources }: { sources: Extract<ChatMessage["parts"][number], { type: "source-url" }>[] }) {
  if (sources.length === 0) return null;
  return (
    <nav className="gen turn-sources" aria-label="Sources">
      <div className="gen-sources">
        <span>From</span>
        {sources.map((source, index) => (
          <SourcePill key={source.url} source={source} index={index} />
        ))}
      </div>
    </nav>
  );
}
