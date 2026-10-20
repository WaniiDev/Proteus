import { describe, expect, test } from "bun:test";

describe("memory page", () => {
  test("is its own destination, not a Settings tab", async () => {
    const settings = await Bun.file(new URL("./views/SettingsView.tsx", import.meta.url)).text();
    const shell = await Bun.file(new URL("./App.tsx", import.meta.url)).text();
    const sidebar = await Bun.file(new URL("./components/Sidebar.tsx", import.meta.url)).text();
    const view = await Bun.file(new URL("./views/MemoryView.tsx", import.meta.url)).text();
    expect(settings).toContain('export type SettingsSection = "providers" | "models" | "appearance" | "developer"');
    expect(settings).not.toContain("MemorySettingsPanel");
    expect(sidebar).toContain('export type View = "companion" | "projects" | "memory" | "settings"');
    expect(shell).toContain('shownView === "memory"');
    expect(shell).toContain('setView("memory")');
    expect(view).toContain('<h1 className="heading">Memory</h1>');
    expect(view).toContain("Nothing is learned silently: only what you save here or approve in a chat.");
    expect(view).toContain("<MemorySettingsPanel focusScope={scope} />");
  });

  test("uses direct deterministic RPCs instead of a model turn", async () => {
    const source = await Bun.file(new URL("./components/MemorySettingsPanel.tsx", import.meta.url)).text();
    for (const method of ["memory.get", "memory.set-enabled", "memory.create", "memory.update", "memory.delete", "memory.reset"]) {
      expect(source).toContain(`rpc.request["${method}"]`);
    }
    expect(source).not.toContain('rpc.request["chat.send"]');
  });

  test("builds the surface from DS List rows and ships none of the old memory CSS", async () => {
    const surface = await Bun.file(new URL("./components/MemorySettingsSurface.tsx", import.meta.url)).text();
    const styles = (await Bun.file(new URL("./index.css", import.meta.url)).text()) + (await Bun.file(new URL("./proteus.css", import.meta.url)).text());
    for (const dsClass of ["list-row switch", "row-compose", "list-row quiet", "list-row danger", "list-note", "list-label kicker"]) {
      expect(surface).toContain(dsClass);
    }
    for (const legacy of ["memory-control", "memory-scope-tabs", "memory-library", "memory-capture", "memory-item", "memory-group", "memory-master-switch", "memory-consent-card"]) {
      expect(surface).not.toContain(legacy);
      expect(styles).not.toContain(`.${legacy}`);
    }
    expect(styles).toContain(".memory-surface .segmented { justify-self: start; }");
  });

  test("does not present guessed memory values when loading fails", async () => {
    const source = await Bun.file(new URL("./components/MemorySettingsPanel.tsx", import.meta.url)).text();
    expect(source).toContain('role="alert"');
    expect(source).toContain("Memory is unavailable");
    expect(source.indexOf("if (!state)")).toBeLessThan(source.indexOf("<MemorySettingsSurface"));
  });
});
