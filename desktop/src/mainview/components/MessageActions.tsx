import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../shared/contracts";
import { Icon } from "./Icon";

export const COPIED_MS = 1600;

export function MessageActions({ message, onRetry, onContinue }: { message: ChatMessage; onRetry?: () => void; onContinue?: () => void }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = () => {
    const pending = navigator.clipboard?.writeText(message.text);
    if (!pending) return;
    void pending.then(() => {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
    }, () => undefined);
  };
  return (
    <div className="turn-actions">
      <button type="button" className="btn btn-ghost sm turn-action" onClick={copy} aria-label="Copy message">
        <Icon name="copy" size={14} />
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </button>
      {message.status === "error" && message.retryable && onRetry && (
        <button type="button" className="btn btn-ghost sm turn-action" onClick={onRetry}>
          <Icon name="retry" size={14} /> Retry
        </button>
      )}
      {message.status === "interrupted" && onContinue && (
        <button type="button" className="btn btn-ghost sm turn-action" onClick={onContinue}>
          <Icon name="play" size={14} /> Continue
        </button>
      )}
    </div>
  );
}
