import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { providerIds } from "../../shared/contracts";
import { BrandTile, ProviderMark } from "./ProviderMark";

describe("ProviderMark", () => {
  for (const id of [...providerIds, "anthropic"]) {
    test(`renders the mono mark for ${id}`, () => {
      const html = renderToStaticMarkup(<ProviderMark provider={id} />);
      expect(html).toContain('class="brand-i"');
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).toContain('fill="currentColor"');
      expect(html).toContain('fill-rule="evenodd"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain(`data-provider-mark="${id}"`);
      expect(html).toContain("<path ");
      expect(html).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
    });
  }

  test("falls back to a neutral dot for an unknown provider", () => {
    const html = renderToStaticMarkup(<ProviderMark provider="nope" />);
    expect(html).toContain('data-provider-mark="fallback"');
    expect(html).toContain("<circle");
    expect(html).not.toContain("<img");
    expect(renderToStaticMarkup(<ProviderMark provider="toString" />)).toContain("fallback");
  });

  test("supports size and className and stays decorative", () => {
    const html = renderToStaticMarkup(<ProviderMark provider="codex" size={14} className="x" />);
    expect(html).toContain('class="brand-i x"');
    expect(html).toContain("width:14px");
    expect(html).toContain('aria-hidden="true"');
  });

  test("BrandTile wraps the mark in the tile classes", () => {
    expect(renderToStaticMarkup(<BrandTile provider="openrouter" />)).toContain('<span class="brand-tile"><svg');
    expect(renderToStaticMarkup(<BrandTile provider="openrouter" small />)).toContain('class="brand-tile sm"');
  });
});
