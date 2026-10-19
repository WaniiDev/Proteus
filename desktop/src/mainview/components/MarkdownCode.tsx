import { type ComponentPropsWithoutRef } from "react";
import { Icon } from "./Icon";

export const markdownComponents = {
  code({ children, className, ...props }: ComponentPropsWithoutRef<"code">) {
    const value = String(children).replace(/\n$/, "");
    return className ? (
      <div className="code-wrap">
        <button
          type="button"
          className="code-copy"
          onClick={() => {
            const pending = navigator.clipboard?.writeText(value);
            if (pending) void pending;
          }}
          aria-label="Copy code"
        >
          <Icon name="copy" size={12} />
        </button>
        <code className={className} {...props}>
          {children}
        </code>
      </div>
    ) : (
      <code {...props}>{children}</code>
    );
  },
};
