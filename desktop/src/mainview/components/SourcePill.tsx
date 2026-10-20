import type { ChatMessage } from "../../shared/contracts";

export function sourceHostname(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, "");
  } catch {
    return urlStr;
  }
}

export function SourcePill({ source, index }: { source: Extract<ChatMessage["parts"][number], { type: "source-url" }>; index: number }) {
  const hostname = sourceHostname(source.url);
  const label = source.title?.trim() || hostname || `Source ${index + 1}`;
  return (
    <a href={source.url} target="_blank" rel="noreferrer" className="gen-source source-link" title={`${label} (${source.url})`}>
      {label}
    </a>
  );
}
