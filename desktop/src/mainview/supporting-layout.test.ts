import { describe, expect, test } from "bun:test";

describe("supporting page layout", () => {
  test("uses one main-page scroll owner", async () => {
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text();
    expect(css).toContain(".app-stage { position: relative; flex: 1; min-width: 0; height: 100%; min-height: 0; overflow: hidden;");
    expect(css).toContain(".app-stage > .view { flex: 1 1 auto; min-height: 0;");
    // App owns the .view wrapper; a page scrolls inside its own block scroller, not a flex .view.active that shrinks .page.
    expect(css).not.toContain(".view.active");
    expect(css).toContain(".projects-view");
    expect(css).toContain(".settings-view");
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
    expect(current).not.toContain(".settings-tabs");
    expect(current.match(/^\.page-narrow \{/gm)).toHaveLength(1);
  });

  test("projects and the delete/forget modals rely on the design system, not app CSS", async () => {
    const current = await Bun.file(new URL("./index.css", import.meta.url)).text();
    for (const old of [".project-library", ".project-detail", ".projects-library", ".project-conversations", ".project-memory-card", ".project-about-card", ".project-warning", ".empty-page", ".confirm-modal", ".modal-icon", ".project-back"]) expect(current).not.toContain(old);
    expect(current).not.toMatch(/^\.btn-danger\s*\{/m);
    expect(current).not.toMatch(/^\.modal-actions\s*\{/m);
    const view = await Bun.file(new URL("./views/ProjectsView.tsx", import.meta.url)).text();
    expect(view).not.toContain("PageHeader");
    expect(view).toContain("page-back");
  });

  test("keeps explicit desktop, tablet, and compact layouts for new surfaces", async () => {
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text();
    expect(css).toContain("@media (max-width: 860px)");
    expect(css).toContain("@media (max-width: 620px)");
  });
});
