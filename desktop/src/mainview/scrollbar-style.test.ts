import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const root = new URL(".", import.meta.url).pathname;

function appCssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "ds" || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return appCssFiles(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

describe("scrollbar system", () => {
  it("sets no scrollbar-width or scrollbar-color in app CSS outside ds/", () => {
    const files = appCssFiles(root);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const css = readFileSync(file, "utf8");
      expect(css).not.toMatch(/scrollbar-(width|color)/);
      expect(css).not.toContain("--scrollbar-thumb");
      expect(css).not.toContain("::-webkit-scrollbar");
    }
  });

  it("keeps the scrollbar section in ds/bundle.css", () => {
    const css = readFileSync(join(root, "ds/bundle.css"), "utf8");
    expect(css).toContain("/* ---------- Scrollbars");
    expect(css).toContain('[data-scrollbar="on"]::-webkit-scrollbar-thumb');
    expect(css).toContain('[data-scrollbar="fading"]::-webkit-scrollbar-thumb');
    expect(css).toMatch(/forced-colors: active\) \{\s*::-webkit-scrollbar-thumb[^}]*CanvasText/);
  });
});
