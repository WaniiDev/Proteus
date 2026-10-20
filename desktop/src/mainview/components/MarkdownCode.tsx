import { type ComponentPropsWithoutRef } from "react";

export const markdownComponents = {
  // Fenced blocks arrive as <pre><code class="language-x">; the pre is the .reply-line.
  pre({ children }: ComponentPropsWithoutRef<"pre">) {
    return <pre className="reply-line">{children}</pre>;
  },
  a({ children, href }: ComponentPropsWithoutRef<"a">) {
    return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
  },
};
