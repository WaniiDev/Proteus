import { describe, expect, it } from "bun:test";
import { interactionSubmissionUi } from "./interaction-ui";

describe("approval interaction UI state", () => {
  it("disables the plan card immediately and shows approval progress", () => {
    expect(interactionSubmissionUi("pending", "approve")).toEqual({
      resolving: true,
      kicker: "Approving plan…",
      approveLabel: "Approving…",
      rejectLabel: "Request changes",
    });
  });

  it("keeps a framework-owned resolving interaction disabled after local submission", () => {
    expect(interactionSubmissionUi("resolving", null)).toMatchObject({ resolving: true, kicker: "Sending response…" });
  });

  it("re-enables recovery actions when an accepted background resume later fails", () => {
    expect(interactionSubmissionUi("failed", "approve")).toMatchObject({ resolving: false, kicker: null, approveLabel: "Approve plan" });
  });
});
