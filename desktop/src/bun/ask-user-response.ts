import type { PendingInteraction } from "../shared/contracts";

type AskUserInteraction = Pick<PendingInteraction, "options" | "selectionMode">;

export type AskUserResponseResolution =
  | { accepted: true; resumeData: string | string[] }
  | { accepted: false; message: string };

type OtherAnswer = {
  kind: "other";
  value: string;
  selections?: unknown;
};

function otherAnswer(value: unknown): OtherAnswer | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { kind?: unknown; value?: unknown; selections?: unknown };
  if (record.kind !== "other" || typeof record.value !== "string") return null;
  return { kind: "other", value: record.value, selections: record.selections };
}

/** Translate Proteus UI answers into Mastra askUserTool's native resume shape. */
export function resolveAskUserResponse(interaction: AskUserInteraction, response: unknown): AskUserResponseResolution {
  const optionLabels = interaction.options.map((option) => option.label);
  const other = otherAnswer(response);

  if (interaction.options.length === 0) {
    if (typeof response !== "string" || !response.trim()) return { accepted: false, message: "Answer cannot be empty." };
    return { accepted: true, resumeData: response.trim() };
  }

  if (interaction.selectionMode === "multi_select") {
    if (other) {
      const custom = other.value.trim();
      const selections = Array.isArray(other.selections) ? other.selections : [];
      if (!custom) return { accepted: false, message: "Type your own answer for Other." };
      if (selections.some((value) => typeof value !== "string" || !optionLabels.includes(value))) {
        return { accepted: false, message: "Choose one or more of the available options." };
      }
      return { accepted: true, resumeData: [...new Set(selections as string[]), custom] };
    }
    if (!Array.isArray(response) || response.length === 0 || response.some((value) => typeof value !== "string" || !optionLabels.includes(value))) {
      return { accepted: false, message: "Choose one or more of the available options." };
    }
    return { accepted: true, resumeData: response };
  }

  if (other) {
    const custom = other.value.trim();
    if (!custom) return { accepted: false, message: "Type your own answer for Other." };
    return { accepted: true, resumeData: custom };
  }
  if (typeof response !== "string" || !optionLabels.includes(response)) {
    return { accepted: false, message: "Choose one of the available options." };
  }
  return { accepted: true, resumeData: response };
}
