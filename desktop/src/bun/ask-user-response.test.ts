import { describe, expect, it } from "bun:test";
import { resolveAskUserResponse } from "./ask-user-response";

const choices = {
  options: [
    { label: "Build", description: "Create something" },
    { label: "Learn", description: "Explore a topic" },
  ],
  selectionMode: "single_select" as const,
};

describe("ask_user response translation", () => {
  it("keeps native free-text and selected-label answers", () => {
    expect(resolveAskUserResponse({ options: [] }, "  My own answer  ")).toEqual({ accepted: true, resumeData: "My own answer" });
    expect(resolveAskUserResponse(choices, "Build")).toEqual({ accepted: true, resumeData: "Build" });
  });

  it("translates the synthetic Other choice to Mastra's native string answer", () => {
    expect(resolveAskUserResponse(choices, { kind: "other", value: "  Something entirely different  " })).toEqual({
      accepted: true,
      resumeData: "Something entirely different",
    });
  });

  it("includes a typed Other answer alongside valid multi-select choices", () => {
    expect(resolveAskUserResponse({ ...choices, selectionMode: "multi_select" }, { kind: "other", value: "Document it", selections: ["Build"] })).toEqual({
      accepted: true,
      resumeData: ["Build", "Document it"],
    });
  });

  it("rejects empty or forged Other submissions", () => {
    expect(resolveAskUserResponse(choices, { kind: "other", value: " " })).toEqual({ accepted: false, message: "Type your own answer for Other." });
    expect(resolveAskUserResponse({ ...choices, selectionMode: "multi_select" }, { kind: "other", value: "Custom", selections: ["Forged"] })).toEqual({
      accepted: false,
      message: "Choose one or more of the available options.",
    });
  });
});
