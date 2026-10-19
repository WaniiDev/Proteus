import { useState } from "react";
import type { ChatMessage } from "../../shared/contracts";
import { Icon } from "./Icon";

export function MessageActions({ message, onRetry, onContinue }: { message: ChatMessage; onRetry?: () => void; onContinue?: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const pending = navigator.clipboard?.writeText(message.text);
    if (pending)
      void pending.then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      });
  };
  return (
    <div className="message-actions">
      <button type="button" className="message-action" onClick={copy} aria-label="Copy message">
        <Icon name="copy" size={13} />
        {copied ? "Copied" : "Copy"}
      </button>
      {message.status === "error" && message.retryable && onRetry && (
        <button type="button" className="message-action" onClick={onRetry}>
          <Icon name="retry" size={13} /> Retry
        </button>
      )}
      {message.status === "interrupted" && onContinue && (
        <button type="button" className="message-action" onClick={onContinue}>
          <Icon name="play" size={13} /> Continue
        </button>
      )}
    </div>
  );
}
