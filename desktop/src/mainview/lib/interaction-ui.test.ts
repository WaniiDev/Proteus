import { describe, expect, it } from "bun:test";
import { interactionSubmissionUi } from "./interaction-ui";

describe("approval interaction UI state", () => {
  it("disables the plan card immediately and shows approval progress", () => {
    expect(interactionSubmissionUi("submit_plan", "pending", "approve")).toEqual({
      resolving: true,
      approveLabel: "Approving…",
      rejectLabel: "Request changes",
    });
  });

  it("uses tool-decision copy for native workspace approvals", () => {
    expect(interactionSubmissionUi("tool_approval", "pending", null)).toMatchObject({ resolving: false, approveLabel: "Approve", rejectLabel: "Decline" });
    expect(interactionSubmissionUi("tool_approval", "pending", null, "Approve edit").approveLabel).toBe("Approve edit");
    expect(interactionSubmissionUi("tool_approval", "pending", "approve")).toMatchObject({ approveLabel: "Approving…" });
    expect(interactionSubmissionUi("tool_approval", "pending", "reject")).toMatchObject({ rejectLabel: "Declining…" });
  });

  it("a question says Answer, then Answering…, and offers no Cancel the runtime could not honour", () => {
    expect(interactionSubmissionUi("ask_user", "pending", null)).toMatchObject({ approveLabel: "Answer", rejectLabel: "" });
    expect(interactionSubmissionUi("ask_user", "pending", "answer")).toMatchObject({ resolving: true, approveLabel: "Answering…" });
  });

  it("keeps a framework-owned resolving interaction disabled after local submission", () => {
    expect(interactionSubmissionUi("submit_plan", "resolving", null)).toMatchObject({ resolving: true });
    expect(interactionSubmissionUi("tool_approval", "resolving", null)).toMatchObject({ resolving: true });
  });

  it("re-enables recovery actions when an accepted background resume later fails", () => {
    expect(interactionSubmissionUi("submit_plan", "failed", "approve")).toMatchObject({ resolving: false, approveLabel: "Approve plan" });
  });
});
