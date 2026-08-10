import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";

const css = readFileSync(new URL("./proteus.css", import.meta.url), "utf8");

describe("application scrollbar system", () => {
  it("defines neutral scrollbar states and applies them globally", () => {
    expect(css).toContain("--scrollbar-thumb:");
    expect(css).toContain("--scrollbar-thumb-hover:");
    expect(css).toContain("--scrollbar-thumb-active:");
    expect(css).toContain("scrollbar-width: thin;");
    expect(css).toContain("scrollbar-color: var(--scrollbar-thumb) transparent;");
    expect(css).toContain("*::-webkit-scrollbar-thumb:hover");
    expect(css).toContain("*::-webkit-scrollbar-thumb:active");
  });

  it("keeps scrollbars compact, rounded, and high-contrast compatible", () => {
    expect(css).toContain("*::-webkit-scrollbar { width: 10px; height: 10px; }");
    expect(css).toContain("min-height: 36px;");
    expect(css).toContain("border-radius: var(--r-pill);");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("scrollbar-color: auto;");
  });

  it("uses the current navigation's compact conversation scrollbar", () => {
    const sidebarCss = readFileSync(new URL("./sidebar.css", import.meta.url), "utf8");
    expect(sidebarCss).toMatch(/\.app-nav__session-list[^}]*scrollbar-width:\s*thin/s);
    expect(css).not.toContain(".sb-menu");
  });
});
