import { describe, expect, test } from "bun:test";

describe("memory settings UI", () => {
  test("keeps memory inside controlled Settings navigation", async () => {
    const app = await Bun.file(new URL("./App.tsx", import.meta.url)).text();
    const sidebar = await Bun.file(new URL("./components/Sidebar.tsx", import.meta.url)).text();
    expect(app).toContain('export type SettingsSection = "providers" | "models" | "memory" | "developer"');
    expect(app).toContain('<MemorySettingsPanel focusScope={memoryScope} />');
    expect(app).not.toContain('view === "memory"');
    expect(sidebar).toContain('export type View = "companion" | "projects" | "settings"');
    expect(sidebar).not.toContain('label: "Memory"');
  });

  test("uses direct deterministic RPCs instead of a model turn", async () => {
    const source = await Bun.file(new URL("./components/MemorySettingsPanel.tsx", import.meta.url)).text();
    const surface = await Bun.file(new URL("./components/MemorySettingsSurface.tsx", import.meta.url)).text();
    for (const method of ["memory.get", "memory.set-enabled", "memory.create", "memory.update", "memory.delete", "memory.reset"]) {
      expect(source).toContain(`rpc.request["${method}"]`);
    }
    expect(source).not.toContain('rpc.request["chat.send"]');
    expect(surface).toContain("Nothing is learned silently.");
  });

  test("uses the new unified memory control surface", async () => {
    const source = await Bun.file(new URL("./components/MemorySettingsSurface.tsx", import.meta.url)).text();
    const styles = await Bun.file(new URL("./index.css", import.meta.url)).text();

    for (const selector of ["memory-control", "memory-scope-tabs", "memory-library", "memory-capture"]) {
      expect(source).toContain(selector);
      expect(styles).toContain(`.${selector}`);
    }

    for (const legacySelector of ["memory-consent-card", "memory-workspace", "memory-editor-card", "memory-compose"]) {
      expect(source).not.toContain(legacySelector);
      expect(styles).not.toContain(`.${legacySelector}`);
    }
  });

  test("does not present guessed memory values when loading fails", async () => {
    const source = await Bun.file(new URL("./components/MemorySettingsPanel.tsx", import.meta.url)).text();
    expect(source).toContain("memory-control--unavailable");
    expect(source).toContain("Memory is unavailable");
    expect(source.indexOf("if (!state)")).toBeLessThan(source.indexOf("<MemorySettingsSurface"));
  });
});
