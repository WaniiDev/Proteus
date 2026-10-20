import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { useDom } from "../test/dom";

const requests: unknown[] = [];
mock.module("../lib/bridge", () => ({ rpc: { request: { "memory.get": async (params: unknown) => { requests.push(params); return new Promise(() => undefined); } } } }));
const { MemoryView } = await import("./MemoryView");

useDom();

describe("MemoryView", () => {
  test("is a Page: heading, the sentence about what Proteus keeps, then the panel", () => {
    const html = renderToStaticMarkup(<MemoryView />);
    expect(html).toContain('<h1 class="heading">Memory</h1>');
    expect(html).toContain("What Proteus keeps between conversations. Nothing is learned silently: only what you save here or approve in a chat.");
    expect(html).toContain('class="page memory-page"');
    expect(html).not.toContain('role="tablist"');
  });
});
