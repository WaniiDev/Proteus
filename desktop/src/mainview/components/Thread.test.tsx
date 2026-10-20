import { afterEach, describe, expect, test } from "bun:test";
import { useDom } from "../test/dom";
useDom();
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "../../shared/contracts";
import { MessageActions, COPIED_MS } from "./MessageActions";
import { ResolvedLine, StoppedNote } from "./ResolvedLine";
import { QueuedMessageBubble } from "./QueuedMessageBubble";
import { WebSearchedSources } from "./WebSearchedSources";
import { markdownComponents } from "./MarkdownCode";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({ id: "m1", role: "assistant", text: "hello", status: "complete", createdAt: new Date().toISOString(), parts: [], ...over }) as ChatMessage;

let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ""; });
const mount = (el: React.ReactElement) => { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); act(() => root!.render(el)); return host; };

describe("MessageActions", () => {
  test("Copy becomes Copied for 1.6s then reverts", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t: string) => { written.push(t); return Promise.resolve(); } } });
    const realSet = window.setTimeout; const timers: Array<() => void> = []; let delay = 0;
    window.setTimeout = ((fn: () => void, ms: number) => { delay = ms; timers.push(fn); return timers.length; }) as unknown as typeof window.setTimeout;
    try {
      const host = mount(<MessageActions message={msg()} />);
      const button = host.querySelector("button")!;
      expect(button.textContent).toContain("Copy");
      await act(async () => { button.click(); });
      expect(written).toEqual(["hello"]);
      expect(button.textContent).toContain("Copied");
      expect(delay).toBe(COPIED_MS);
      expect(COPIED_MS).toBe(1600);
      act(() => timers.at(-1)!());
      expect(button.textContent).toContain("Copy");
      expect(button.textContent).not.toContain("Copied");
    } finally { window.setTimeout = realSet; }
  });
  test("Retry only for retryable errors, Continue only when interrupted", () => {
    let retried = 0, continued = 0;
    const err = mount(<MessageActions message={msg({ status: "error", retryable: true })} onRetry={() => retried++} onContinue={() => continued++} />);
    const labels = [...err.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(labels).toEqual(["Copy", "Retry"]);
    act(() => (err.querySelectorAll("button")[1] as HTMLButtonElement).click());
    expect(retried).toBe(1);
    act(() => root!.unmount());
    const stopped = mount(<MessageActions message={msg({ status: "interrupted" })} onRetry={() => retried++} onContinue={() => continued++} />);
    expect([...stopped.querySelectorAll("button")].map((b) => b.textContent?.trim())).toEqual(["Copy", "Continue"]);
    act(() => (stopped.querySelectorAll("button")[1] as HTMLButtonElement).click());
    expect(continued).toBe(1);
  });
});

describe("thread pieces", () => {
  test("resolved line and stopped note copy", () => {
    expect(renderToStaticMarkup(<ResolvedLine label="Approved" title="Edit docs/plan.md" note="2 days ago" />)).toContain("Approved · <span class=\"resolved-title\">Edit docs/plan.md</span> — 2 days ago");
    expect(renderToStaticMarkup(<ResolvedLine label="Cancelled" title="x" tone="muted" />)).toContain('class="dot"');
    expect(renderToStaticMarkup(<StoppedNote />)).toBe('<p class="stopped">Stopped. Nothing was sent or saved.</p>');
  });
  test("queued bubble is muted, labelled, cancellable only while queued", () => {
    const draft = { id: "d", threadId: "t", text: "later", createdAt: "", state: "queued" as const };
    const html = renderToStaticMarkup(<QueuedMessageBubble draft={draft} onCancel={() => {}} />);
    expect(html).toContain("Queued");
    expect(html).toContain("Cancel");
    expect(renderToStaticMarkup(<QueuedMessageBubble draft={{ ...draft, state: "sending" }} onCancel={() => {}} />)).not.toContain("Cancel");
  });
  test("sources render as From + mono pills", () => {
    const html = renderToStaticMarkup(<WebSearchedSources sources={[{ type: "source-url", sourceId: "s", url: "https://www.example.com/a", title: "" } as never]} />);
    expect(html).toContain("gen-sources");
    expect(html).toContain("From");
    expect(html).toContain("gen-source");
    expect(html).toContain(">example.com<");
  });
  test("markdown: paragraphs under .reply, fenced code is a reply-line", () => {
    const html = renderToStaticMarkup(<div className="reply"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{"Hi\n\n```ts\nconst a = 1;\n```\n\n- one\n- `two`"}</ReactMarkdown></div>);
    expect(html).toContain("<p>Hi</p>");
    expect(html).toContain('<pre class="reply-line">');
    expect(html).toContain("<li>");
  });
});
