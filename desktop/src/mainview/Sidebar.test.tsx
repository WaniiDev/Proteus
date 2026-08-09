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
      threads={[]}
      activeThreadId={null}
      onSwitch={() => undefined}
    />);

    expect(html).toContain("lucide-square-pen");
    expect(html).toContain("lucide-messages-square");
    expect(html).toContain("lucide-panels-top-left");
    expect(html).toContain("lucide-book-open-text");
    expect(html).toContain("lucide-sliders-horizontal");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="New chat"');
    expect(html).toContain("proteus-orb-256.png");
    expect(html).toContain('class="app-nav__orb-image"');
    expect(html).toContain("Recent chats");
  });

  it("renders the local conversation library in the expanded desktop sidebar", () => {
    const html = renderToStaticMarkup(<Sidebar
      view="companion"
      open
      disabled={false}
      onView={() => undefined}
      onToggle={() => undefined}
      onCreate={() => undefined}
      threads={[{ id: "thread-1", title: "Workspace architecture", createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z", activity: "idle", attention: 0, workspace: { binding: { kind: "app" }, label: "Proteus workspace", availability: "ready" } }]}
      activeThreadId="thread-1"
      onSwitch={() => undefined}
    />);

    expect(html).toContain("Workspace architecture");
    expect(html).toContain("app-nav__recent--active");
    expect(html).toContain("Collapse sidebar");
  });

  it("styles the selected icon with a restrained Proteus pastel halo", async () => {
    const css = await Bun.file(new URL("./sidebar.css", import.meta.url)).text();

    expect(css).toContain(".app-nav__icon-track::before");
    expect(css).toContain("rgba(167, 229, 211, .28)");
    expect(css).toContain("rgba(200, 184, 224, .3)");
    expect(css).toContain(".app-nav__link--active .app-nav__icon-track::before");
  });
});
