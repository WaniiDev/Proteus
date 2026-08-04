import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("uses the cohesive editorial icon set with correct navigation semantics", () => {
    const html = renderToStaticMarkup(<Sidebar
      view="companion"
      open={false}
      disabled={false}
      onView={() => undefined}
      onToggle={() => undefined}
      onCreate={() => undefined}
    />);

    expect(html).toContain("lucide-square-pen");
    expect(html).toContain("lucide-messages-square");
    expect(html).toContain("lucide-panels-top-left");
    expect(html).toContain("lucide-book-open-text");
    expect(html).toContain("lucide-sliders-horizontal");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="New chat"');
  });

  it("styles the selected icon with a restrained PROTEUS pastel halo", async () => {
    const css = await Bun.file(new URL("./sidebar.css", import.meta.url)).text();

    expect(css).toContain(".app-nav__icon-track::before");
    expect(css).toContain("rgba(167, 229, 211, .28)");
    expect(css).toContain("rgba(200, 184, 224, .3)");
    expect(css).toContain(".app-nav__link--active .app-nav__icon-track::before");
  });
});
