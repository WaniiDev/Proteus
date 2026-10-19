import { describe, expect, it } from "bun:test";
import { interactionSubmissionUi } from "./interaction-ui";

describe("approval interaction UI state", () => {
  it("disables the plan card immediately and shows approval progress", () => {
    expect(interactionSubmissionUi("submit_plan", "pending", "approve")).toEqual({
      resolving: true,
      kicker: "Approving plan…",
      approveLabel: "Approving…",
      rejectLabel: "Request changes",
    });
  });

  it("uses tool-decision copy for native workspace approvals", () => {
    expect(interactionSubmissionUi("tool_approval", "pending", null)).toMatchObject({ resolving: false, approveLabel: "Approve tool", rejectLabel: "Decline" });
    expect(interactionSubmissionUi("tool_approval", "pending", "approve")).toMatchObject({ kicker: "Approving tool…", approveLabel: "Approving…" });
    expect(interactionSubmissionUi("tool_approval", "pending", "reject")).toMatchObject({ kicker: "Declining tool…", rejectLabel: "Declining…" });
  });

  it("keeps a framework-owned resolving interaction disabled after local submission", () => {
    expect(interactionSubmissionUi("submit_plan", "resolving", null)).toMatchObject({ resolving: true, kicker: "Sending response…" });
    expect(interactionSubmissionUi("tool_approval", "resolving", null)).toMatchObject({ resolving: true, kicker: "Applying tool decision…" });
  });

  it("re-enables recovery actions when an accepted background resume later fails", () => {
    expect(interactionSubmissionUi("submit_plan", "failed", "approve")).toMatchObject({ resolving: false, kicker: null, approveLabel: "Approve plan" });
  });
});
