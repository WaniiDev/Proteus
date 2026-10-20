import { describe, expect, test } from "bun:test";
import type { RuntimeSnapshot } from "../../../shared/contracts";
import { conversationDetails } from "./DetailsDialog";

const snapshot = (status: string, availability: string) => ({
  models: [], providers: [], selectedModelId: "openrouter/auto", selectedProviderId: "openrouter", activeThreadId: "t1", activeRun: null,
  workbench: { status, tokenUsage: { promptTokens: 1200, completionTokens: 30, totalTokens: 1230 } },
  activeWorkspace: { binding: { kind: "app" }, label: "Proteus workspace", availability },
}) as unknown as RuntimeSnapshot;
const value = (rows: ReturnType<typeof conversationDetails>, label: string) => rows.find((row) => row.label === label)?.value;

describe("conversation details", () => {
  test("say status and availability in words, not enum values", () => {
    const rows = conversationDetails(snapshot("idle", "ready"));
    expect(value(rows, "Status")).toBe("At rest");
    expect(value(rows, "Availability")).toBe("Folder connected");
    const other = conversationDetails(snapshot("waiting", "missing"));
    expect(value(other, "Status")).toBe("Needs you");
    expect(value(other, "Availability")).toBe("Folder not found");
    for (const [status, word] of [["active", "Working"], ["complete", "Done"], ["interrupted", "Stopped"], ["error", "Failed"]]) expect(value(conversationDetails(snapshot(status!, "ready")), "Status")).toBe(word!);
  });
});
