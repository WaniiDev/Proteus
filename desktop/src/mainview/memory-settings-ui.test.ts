import { describe, expect, test } from "bun:test";

describe("memory settings UI", () => {
  test("keeps memory inside controlled Settings navigation", async () => {
    const app = await Bun.file(new URL("./App.tsx", import.meta.url)).text();
    const sidebar = await Bun.file(new URL("./Sidebar.tsx", import.meta.url)).text();
    expect(app).toContain('export type SettingsSection = "providers" | "models" | "memory" | "developer"');
    expect(app).toContain('<MemorySettingsPanel focusScope={memoryScope} />');
    expect(app).not.toContain('view === "memory"');
    expect(sidebar).toContain('export type View = "companion" | "projects" | "settings"');
    expect(sidebar).not.toContain('label: "Memory"');
  });

  test("uses direct deterministic RPCs instead of a model turn", async () => {
    const source = await Bun.file(new URL("./MemorySettingsPanel.tsx", import.meta.url)).text();
    for (const method of ["memory.get", "memory.set-enabled", "memory.create", "memory.update", "memory.delete", "memory.reset"]) {
      expect(source).toContain(`rpc.request["${method}"]`);
    }
    expect(source).not.toContain('rpc.request["chat.send"]');
    expect(source).toContain("Nothing is learned silently.");
  });
});
