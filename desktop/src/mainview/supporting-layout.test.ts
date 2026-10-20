import { describe, expect, test } from "bun:test";

describe("supporting page layout", () => {
  test("uses one main-page scroll owner", async () => {
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text();
    expect(css).toContain(".app-stage { position: relative; flex: 1; min-width: 0; height: 100%; min-height: 0; overflow: hidden;");
    expect(css).toContain(".app-stage > .view { flex: 1 1 auto; min-height: 0;");
    expect(css).toContain(".view.active { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; overflow: auto;");
  });

  test("the shell uses the system ambient field and drops the legacy orbs and view animation", async () => {
    const base = await Bun.file(new URL("./proteus.css", import.meta.url)).text();
    const app = await Bun.file(new URL("./App.tsx", import.meta.url)).text();
    expect(base).not.toContain(".ambient");
    expect(base).not.toContain("viewIn");
    expect(base).not.toMatch(/^\.view \{ display: none/m);
    expect(app).toContain('<div className="ambient" aria-hidden="true"><i /><i /><i /></div>');
    expect(app).toContain("<Lens />");
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
    expect(css).toMatch(/\.memory-group__items\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*860px\)[\s\S]*?\.memory-group__items\s*\{[^}]*grid-template-columns:\s*1fr/);
    expect(css).toMatch(/@media\s*\(max-width:\s*620px\)[\s\S]*?\.memory-control__header\s*\{[^}]*flex-direction:\s*column/);
    expect(css).toContain(".project-detail-grid { display: grid; grid-template-columns:");
    expect(css).toContain("@media (max-width: 860px)");
    expect(css).toContain("@media (max-width: 620px)");
  });
});
