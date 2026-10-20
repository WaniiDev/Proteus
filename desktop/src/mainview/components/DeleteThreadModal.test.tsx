import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ThreadSummary } from "../../shared/contracts";
import { DeleteThreadModal } from "./DeleteThreadModal";

const thread = { id: "t1", title: "Quarterly plan" } as ThreadSummary;

describe("DeleteThreadModal", () => {
  test("is the system Modal with the README copy and a danger commit", () => {
    const html = renderToStaticMarkup(<DeleteThreadModal thread={thread} onCancel={() => {}} onConfirm={() => {}} />);
    expect(html).toContain('class="scrim"');
    expect(html).toContain("Delete conversation?");
    expect(html).toContain("Quarterly plan</strong> will be removed from this device.");
    expect(html).toContain("btn btn-danger sm");
    expect(html).not.toContain("confirm-modal");
  });
});
