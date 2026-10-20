import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const names = (css: string) => new Set([...css.matchAll(/(?:^|[;{\s])(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

test("app CSS does not redefine a design-system custom property", () => {
  const ds = names(readFileSync(new URL("./ds/tokens.css", import.meta.url), "utf8"));
  for (const file of ["proteus.css", "index.css", "sidebar.css"]) {
    const dupes = [...names(readFileSync(new URL(`./${file}`, import.meta.url), "utf8"))].filter((n) => ds.has(n));
    expect({ file, dupes }).toEqual({ file, dupes: [] });
  }
});
