import { describe, expect, it } from "bun:test";

describe("context panel policy", () => {
  it("opens only through explicit user interaction", async () => {
    const source = await Bun.file(new URL("./App.tsx", import.meta.url)).text();

    expect(source).not.toContain("autoOpenedContextThreads");
    expect(source).not.toContain("workbenchHasContent");
    expect(source).toContain('aria-label={contextOpen ? "Close context" : "Open context"}');
    expect(source).toContain("!contextOpen");
  });
});
