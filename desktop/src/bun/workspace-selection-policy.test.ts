import { describe, expect, test } from "bun:test";
import { workspaceSelectionBlocker, type WorkspaceSelectionActivity } from "./workspace-selection-policy";

const idle = (): WorkspaceSelectionActivity => ({
  runtimeBusy: false,
  queuedCount: 0,
  storedMessageCount: 0,
  hasOptimisticMessage: false,
  suspensionCount: 0,
  hasPendingInteraction: false,
});

describe("empty-conversation workspace selection", () => {
  test("allows a truly empty idle conversation", () => {
    expect(workspaceSelectionBlocker(idle())).toBeNull();
  });

  test("rejects active and queued work as busy", () => {
    expect(workspaceSelectionBlocker({ ...idle(), runtimeBusy: true })?.code).toBe("busy");
    expect(workspaceSelectionBlocker({ ...idle(), queuedCount: 1 })?.code).toBe("busy");
  });

  test("rejects every form of existing conversation activity", () => {
    expect(workspaceSelectionBlocker({ ...idle(), storedMessageCount: 1 })?.code).toBe("not-empty");
    expect(workspaceSelectionBlocker({ ...idle(), hasOptimisticMessage: true })?.code).toBe("not-empty");
    expect(workspaceSelectionBlocker({ ...idle(), suspensionCount: 1 })?.code).toBe("not-empty");
    expect(workspaceSelectionBlocker({ ...idle(), hasPendingInteraction: true })?.code).toBe("not-empty");
  });
});
