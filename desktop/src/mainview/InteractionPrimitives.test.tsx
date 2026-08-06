import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InteractionActions, interactionVariant } from "./InteractionPrimitives";

describe("shared interaction variants", () => {
  it("maps framework interaction kinds to stable visual variants", () => {
    expect(interactionVariant("submit_plan")).toBe("plan");
    expect(interactionVariant("tool_approval")).toBe("tool");
    expect(interactionVariant("ask_user")).toBe("question");
    expect(interactionVariant("tool_approval", true)).toBe("recovery");
  });

  it("renders variant-specific action labels without plan leakage", () => {
    const tool = renderToStaticMarkup(<InteractionActions variant="tool" disabled={false} secondaryLabel="Decline" onSecondary={() => undefined} primaryLabel="Approve tool" onPrimary={() => undefined} />);
    const plan = renderToStaticMarkup(<InteractionActions variant="plan" disabled={false} secondaryLabel="Request changes" onSecondary={() => undefined} primaryLabel="Approve plan" onPrimary={() => undefined} />);
    expect(tool).toContain("Decline");
    expect(tool).toContain("Approve tool");
    expect(tool).not.toContain("plan");
    expect(plan).toContain("Request changes");
    expect(plan).toContain("Approve plan");
  });
});
