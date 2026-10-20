import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../shared/contracts";
import { Icon } from "./Icon";

export const COPIED_MS = 1600;

export function copyLabel(message: Pick<ChatMessage, "role" | "text">): string {
  const flat = message.text.replace(/\s+/g, " ").trim();
  const excerpt = flat.length > 40 ? `${flat.slice(0, 40).trimEnd()}…` : flat;
  const base = message.role === "user" ? "Copy your message" : "Copy reply";
  return excerpt ? `${base}: ${excerpt}` : base;
}

/** Copy sits under replies only; each button names its message so a screen reader can tell them apart. */
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
  const retry = message.status === "error" && message.retryable && onRetry;
  const resume = message.status === "interrupted" && onContinue;
  if (!message.text.trim() && !retry && !resume) return null;
  return (
    <div className="turn-actions">
      {message.text.trim() && (
        <button type="button" className="btn btn-ghost sm turn-action" onClick={copy} aria-label={copyLabel(message)}>
          <Icon name="copy" size={14} />
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      )}
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
