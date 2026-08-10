import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Sidebar, sessionMenuPosition } from "./Sidebar";

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
    expect(html).toContain("lucide-house");
    expect(html).toContain("lucide-panels-top-left");
    expect(html).not.toContain("lucide-book-open-text");
    expect(html).not.toContain('aria-label="Memory"');
    expect(html).toContain("lucide-sliders-horizontal");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="New chat"');
    expect(html).toContain("proteus-orb-256.png");
    expect(html).toContain('class="app-nav__orb-image"');
    expect(html).toContain("Proteus");
    expect(html).toContain("Home");
  });

  it("styles the selected icon with a restrained Proteus pastel halo", async () => {
    const css = await Bun.file(new URL("./sidebar.css", import.meta.url)).text();

    expect(css).toContain(".app-nav__icon-track::before");
    expect(css).toContain("rgba(167, 229, 211, .3)");
    expect(css).toContain("rgba(200, 184, 224, .32)");
    expect(css).toContain(".app-nav__link--active .app-nav__icon-track::before");
    expect(css).toContain("@media (min-width: 1100px)");
    expect(css).toContain("width: 248px");
    expect(css).toContain(".app-nav__session-menu { position: fixed; z-index: 200;");
  });

  it("keeps the session action menu within the viewport and flips it above the button", () => {
    expect(sessionMenuPosition({ top: 700, bottom: 726, right: 240 } as DOMRect, 800, 740)).toEqual({ left: 114, top: 618 });
    expect(sessionMenuPosition({ top: 50, bottom: 76, right: 100 } as DOMRect, 800, 740)).toEqual({ left: 8, top: 80 });
  });

  it("keeps the navigation open when selecting a sidebar destination or starting a chat", async () => {
    const source = await Bun.file(new URL("./App.tsx", import.meta.url)).text();
    const navigateHandler = source.match(/const handleNavigate = \(next: View\) => \{([\s\S]*?)\n  \};/)?.[1] ?? "";
    const createHandler = source.match(/const handleCreate = \(\) => \{([\s\S]*?)\n  \};/)?.[1] ?? "";

    expect(navigateHandler).toContain("setView(next)");
    expect(navigateHandler).not.toContain("setSidebarOpen(false)");
    expect(createHandler).toContain("setNewChatOpen(true)");
    expect(createHandler).not.toContain("setSidebarOpen(false)");
  });
});
