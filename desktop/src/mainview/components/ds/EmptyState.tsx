import type { ReactNode } from "react";

// A dashed well for a library with nothing in it yet: a title naming what is missing,
// one sentence on what will appear and why it helps, and the one action that fills it.
export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
