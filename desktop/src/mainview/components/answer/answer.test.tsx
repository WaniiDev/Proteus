import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatAnswerPart } from "../../../shared/contracts";
import { AnswerBody } from "./AnswerBody";
import { AnswerCard } from "./AnswerCard";
import { blockRegistry } from "./AnswerBlocks";
import { ANSWER_BLOCK_TYPES, makeAnswer, fullBlocks } from "./test-fixtures";

const html = (answer: ChatAnswerPart) => renderToStaticMarkup(<AnswerBody answer={answer} />);

describe("answer block registry", () => {
  it("has one component per catalog block plus the fallback", () => {
    expect(Object.keys(blockRegistry).sort()).toEqual([...ANSWER_BLOCK_TYPES, "fallback"].sort());
  });
});

describe("block markup and roles", () => {
  const out = html(makeAnswer(fullBlocks));

  it("headline and text", () => {
    expect(out).toContain('<h2 class="gen-headline">Three things need you</h2>');
    expect(out).toContain('<p class="gen-text">Context only.</p>');
  });

  it("stats with delta, decorative spark and tenths classes, never a style", () => {
    expect(out).toContain('class="gen-delta is-up"');
    expect(out).toContain('class="gen-delta is-down"');
    expect(out).toContain('<span class="gen-spark" aria-hidden="true"><i class="s-2"></i><i class="s-10"></i></span>');
    expect(out).not.toContain("style=");
    expect(out).toContain("gen-stat-foot");
  });

  it("list rows: dot, warn dot, tick, time, named action", () => {
    expect(out).toContain('<span class="dot warn"></span>');
    expect(out).toContain('<span class="gen-tick">');
    expect(out).toContain('aria-label="Draft reply: Reply to the vendor"');
    expect(out).toContain('class="gen-act primary"');
    expect(out).toContain('<span class="gen-row-end">07:02</span>');
  });

  it("timeline uses list roles, past and now marks", () => {
    expect(out).toContain('class="gen-timeline" role="list" aria-label="Today"');
    expect(out).toContain('class="gen-tl-row is-past" role="listitem"');
    expect(out).toContain('class="gen-tl-row is-now" role="listitem"');
    expect(out).toContain('<span class="gen-now">Now</span>');
  });

  it("progress meters carry role, values and text", () => {
    expect(out).toContain('class="gen-meter-track w-7" role="meter" aria-label="Launch" aria-valuemin="0" aria-valuemax="10" aria-valuenow="7" aria-valuetext="7 of 10"');
    expect(out).toContain('class="gen-meter is-warn"');
    expect(out).toContain("w-9");
  });

  it("table uses table roles and a column class", () => {
    expect(out).toContain('class="gen-table cols-2" role="table" aria-label="Options"');
    expect(out).toContain('<span role="columnheader">Plan</span>');
    expect(out).toContain('<div role="row" class="is-pick"><span role="cell">Annual</span>');
  });

  it("bars are an image labelled with every value", () => {
    expect(out).toContain('role="img" aria-label="Focus hours: Mon 4, Wed 9"');
    expect(out).toContain('class="gen-bar h-4"');
    expect(out).toContain('class="gen-bar h-9 is-hi"');
  });

  it("diff announces removed and added lines and names its actions", () => {
    expect(out).toContain('role="group" aria-label="Proposed edit to docs/plan.md, line 14"');
    expect(out).toContain('<span class="sr-only">Removed: </span>old');
    expect(out).toContain('<span class="sr-only">Added: </span>new');
    expect(out).toContain('class="gen-diff-line del"');
    expect(out).toContain('class="gen-diff-line ins"');
    expect(out).toContain('aria-label="Not now: leave docs/plan.md unchanged"');
    expect(out).toContain('aria-label="Approve the edit to docs/plan.md"');
  });

  it("quote, sources, suggest", () => {
    expect(out).toContain('<figure class="gen-quote"><p>Keep Friday light.</p><cite>notes.md</cite></figure>');
    expect(out).toContain('<div class="gen-sources"><span>From</span><span class="gen-source">notes.md</span>');
    expect(out).toContain('<div class="gen-suggest"><button type="button" class="gen-chip">Show next week</button>');
  });

  it("choice is a radiogroup with a roving tab stop and a disabled Confirm", () => {
    expect(out).toContain('role="radiogroup" aria-label="Which plan?"');
    expect(out).toMatch(/role="radio" aria-checked="false" tabindex="0"[^>]*><span class="gen-radio"/);
    expect(out).toMatch(/role="radio" aria-checked="false" tabindex="-1"/);
    expect(out).toContain('<span class="gen-option-tag">Best value</span>');
    expect(out).toMatch(/class="gen-act primary" disabled="" aria-label="Choose"/);
  });

  it("renders a fallback and keeps the rest", () => {
    const o = html(makeAnswer([{ type: "fallback" }, { type: "text", text: "Still here." }]));
    expect(o).toContain('<p class="gen-fallback" role="note">');
    expect(o).toContain("One part of this answer couldn’t be shown.");
    expect(o).toContain("Still here.");
  });
});

describe("streaming and outcomes", () => {
  it("shows gen-more only while streaming", () => {
    expect(html(makeAnswer(fullBlocks, { streaming: true }))).toContain('class="gen-more" aria-label="Still answering"');
    expect(html(makeAnswer(fullBlocks))).not.toContain("gen-more");
  });

  it("shows outcomes in place of actions", () => {
    const o = html(makeAnswer(fullBlocks, { outcomes: { r1: "Drafted", d1: "Approved · edited", c1: "Chosen · Annual" } }));
    expect(o).toContain('class="gen-row is-done"');
    expect(o).toContain("Drafted</span>");
    expect(o).not.toContain('aria-label="Draft reply');
    expect(o).toContain('class="gen-diff is-done"');
    expect(o).toContain("Approved · edited");
    expect(o).not.toContain("Not now: leave");
    expect(o).toContain('class="gen-choice is-done"');
    expect(o).toContain("Chosen · Annual");
    expect(o).toMatch(/aria-checked="true" tabindex="0" disabled=""/);
  });

  it("shows the skipped diff outcome", () => {
    expect(html(makeAnswer(fullBlocks, { outcomes: { d1: "Not now · unchanged" } }))).toContain("Not now · unchanged");
  });
});

describe("AnswerCard", () => {
  it("is the thread card with the same blocks", () => {
    const o = renderToStaticMarkup(<AnswerCard answer={makeAnswer(fullBlocks)} />);
    expect(o).toContain('<section class="gen-card enter" aria-label="Your week">');
    expect(o).toContain("Answer · Your week");
    expect(o).toContain('<h2 class="gen-headline">');
    expect(o).toContain('class="gen-table cols-2"');
  });
});

describe("AnswerBody announcements", () => {
  it("renders its own status region unless a callback takes over", () => {
    expect(html(makeAnswer(fullBlocks, { streaming: true }))).toContain('role="status" aria-live="polite">Answering</div>');
    const o = renderToStaticMarkup(<AnswerBody answer={makeAnswer(fullBlocks)} onAnnounce={() => undefined} />);
    expect(o).not.toContain('role="status"');
  });
});
