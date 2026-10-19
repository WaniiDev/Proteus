import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { MemorySettingsState } from "../../shared/contracts";
import { MemorySettingsSurface } from "./MemorySettingsSurface";

function memoryState(): MemorySettingsState {
  return {
    enabled: true,
    scopes: [
      {
        scope: { kind: "global" },
        key: "global",
        label: "Everywhere",
        status: "active",
        entries: [{
          id: "memory-1",
          category: "preference",
          content: "Lead status updates with blockers.",
          createdAt: "2026-08-10T09:00:00.000Z",
          updatedAt: "2026-08-11T09:00:00.000Z",
        }],
      },
      {
        scope: { kind: "project", projectId: "proteus" },
        key: "project:proteus",
        label: "Proteus",
        status: "archived",
        entries: [],
      },
    ],
  };
}

function render(state: MemorySettingsState, focusKey = "global", error: string | null = null): string {
  const saved = async () => true;
  return renderToStaticMarkup(<MemorySettingsSurface
    state={state}
    focusKey={focusKey}
    busy={false}
    error={error}
    onSetEnabled={saved}
    onCreate={saved}
    onUpdate={saved}
    onDelete={saved}
    onReset={saved}
  />);
}

describe("memory settings redesign", () => {
  test("renders enabled memory, spaces, saved entries, and every mutation control", () => {
    const html = render(memoryState());
    expect(html).toContain("Memory is on");
    expect(html).toContain("1 item saved");
    expect(html).toContain("All workspaces");
    expect(html).toContain("Archived project");
    expect(html).toContain("Lead status updates with blockers.");
    expect(html).toContain("Clear this space");
    expect(html).toContain("Save memory");
    expect(html).toContain("Edit Lead status updates with blockers.");
    expect(html).toContain("Delete Lead status updates with blockers.");
  });

  test("renders a paused state without hiding saved context", () => {
    const state = memoryState();
    state.enabled = false;
    const html = render(state);
    expect(html).toContain("Memory is paused");
    expect(html).toContain("Saved items stay here, but are not used");
    expect(html).toContain("Lead status updates with blockers.");
  });

  test("renders the focused archived project and its empty state", () => {
    const html = render(memoryState(), "project:proteus");
    expect(html).toContain("<h3>Proteus</h3>");
    expect(html).toContain("Archived project");
    expect(html).toContain("This space is clear");
    expect(html).toContain("Available only to future chats attached to this project.");
  });

  test("keeps a failed mutation visible without discarding loaded state", () => {
    const html = render(memoryState(), "global", "The memory change could not be saved. Nothing was changed.");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Nothing was changed.");
    expect(html).toContain("Lead status updates with blockers.");
  });
});
