import { useState } from "react";
import { Globe } from "lucide-react";
import type { ChatMessage } from "../../shared/contracts";

function sourceHostname(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, "");
  } catch {
    return urlStr;
  }
}

export function SourcePill({ source, index }: { source: Extract<ChatMessage["parts"][number], { type: "source-url" }>; index: number }) {
  const [imgError, setImgError] = useState(false);
  const hostname = sourceHostname(source.url);
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;
  const label = source.title?.trim() || hostname || `Source ${index + 1}`;

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      className="source-pill"
      title={`${label} (${source.url})`}
    >
      {!imgError && hostname ? (
        <img
          src={faviconUrl}
          alt=""
          className="source-favicon"
          onError={() => setImgError(true)}
          width={14}
          height={14}
        />
      ) : (
        <Globe className="source-favicon-fallback" />
      )}
      <span className="source-label">{label}</span>
    </a>
  );
}
