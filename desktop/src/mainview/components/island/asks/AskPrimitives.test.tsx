import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AskActions, interactionVariant } from "./AskPrimitives";

describe("shared ask variants", () => {
  it("maps framework interaction kinds to stable visual variants", () => {
    expect(interactionVariant("submit_plan")).toBe("plan");
    expect(interactionVariant("tool_approval")).toBe("tool");
    expect(interactionVariant("ask_user")).toBe("question");
    expect(interactionVariant("tool_approval", true)).toBe("recovery");
  });

  it("renders Decline as the quiet island button and the yes as the island button, per variant", () => {
    const tool = renderToStaticMarkup(<AskActions variant="tool" disabled={false} secondaryLabel="Decline" onSecondary={() => undefined} primaryLabel="Approve edit" onPrimary={() => undefined} />);
    const plan = renderToStaticMarkup(<AskActions variant="plan" disabled={false} secondaryLabel="Request changes" onSecondary={() => undefined} primaryLabel="Approve plan" onPrimary={() => undefined} />);
    expect(tool).toContain('class="btn btn-island-quiet"');
    expect(tool).toContain('class="btn btn-island"');
    expect(tool).toContain("Decline");
    expect(tool).toContain("Approve edit");
    expect(tool).not.toContain("plan");
    expect(plan).toContain("Request changes");
    expect(plan).toContain("Approve plan");
  });

  it("shows a spinner and disables both buttons while a decision is being sent", () => {
    const busy = renderToStaticMarkup(<AskActions variant="tool" disabled busy secondaryLabel="Decline" onSecondary={() => undefined} primaryLabel="Approving…" onPrimary={() => undefined} />);
    expect(busy).toContain('class="spinner"');
    expect(busy.match(/disabled=""/g)).toHaveLength(2);
    expect(busy).toContain("Approving…");
  });
});
