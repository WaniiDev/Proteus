import { describe, expect, test } from "bun:test";

describe("supporting page layout", () => {
  test("uses one main-page scroll owner", async () => {
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text();
    expect(css).toContain("main { height: 100%; min-height: 0; overflow: hidden;");
    expect(css).toContain(".view.active { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; overflow: auto;");
  });

  test("does not retain the legacy sidebar, memory, or project layout rules", async () => {
    const base = await Bun.file(new URL("./proteus.css", import.meta.url)).text();
    const current = await Bun.file(new URL("./index.css", import.meta.url)).text();
    expect(base).not.toContain(".app-shell { flex-direction: column;");
    expect(base).not.toContain(".project-grid");
    expect(base).not.toContain(".memory-cols");
    expect(base).not.toContain(".setting-row");
    expect(current.match(/^\.settings-tabs \{/gm)).toHaveLength(1);
    expect(current.match(/^\.page-narrow \{/gm)).toHaveLength(1);
  });

  test("keeps explicit desktop, tablet, and compact layouts for new surfaces", async () => {
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text();
    expect(css).toContain(".memory-workspace { display: grid; grid-template-columns: 190px minmax(0,1fr)");
    expect(css).toContain(".project-detail-grid { display: grid; grid-template-columns:");
    expect(css).toContain("@media (max-width: 860px)");
    expect(css).toContain("@media (max-width: 620px)");
  });
});
