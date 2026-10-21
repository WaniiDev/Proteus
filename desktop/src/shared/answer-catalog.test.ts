import { describe, expect, it } from "bun:test";
import { checkAnswer, compositionIssues, containsMarkup, repairComposition, validateAnswer, validateBlock } from "./answer-catalog";

const headline = { type: "headline", text: "Two things need you today." };
const row = (i = 1) => ({ id: `r${i}`, title: `Row ${i}` });
const ok = (b: unknown) => expect(validateBlock(b).ok).toBe(true);
const bad = (b: unknown) => expect(validateBlock(b).ok).toBe(false);
const answer = (blocks: unknown[]) => ({ v: 2, title: "Today", blocks });
const n = <T>(count: number, make: (i: number) => T) => Array.from({ length: count }, (_, i) => make(i + 1));

describe("block limits", () => {
  it("headline <= 140", () => {
    ok({ type: "headline", text: "a".repeat(140) });
    bad({ type: "headline", text: "a".repeat(141) });
    bad({ type: "headline", text: "" });
  });
  it("text <= 320", () => {
    ok({ type: "text", text: "a".repeat(320) });
    bad({ type: "text", text: "a".repeat(321) });
  });
  it("stats 1-3 items, sparkline needs delta and 2-12 values", () => {
    const item = { value: "1,284", label: "Visits" };
    ok({ type: "stats", items: [item] });
    ok({ type: "stats", items: n(3, () => item) });
    bad({ type: "stats", items: [] });
    bad({ type: "stats", items: n(4, () => item) });
    const spark = (k: number) => ({ ...item, delta: "+38%", dir: "up", spark: n(k, () => 5) });
    ok({ type: "stats", items: [spark(2)] });
    ok({ type: "stats", items: [spark(12)] });
    bad({ type: "stats", items: [spark(1)] });
    bad({ type: "stats", items: [spark(13)] });
    bad({ type: "stats", items: [{ ...item, spark: [1, 2] }] });
    bad({ type: "stats", items: [{ ...spark(2), spark: [1, 11] }] });
  });
  it("list 1-12 rows", () => {
    ok({ type: "list", label: "L", rows: [row()] });
    ok({ type: "list", label: "L", rows: n(12, row) });
    bad({ type: "list", label: "L", rows: [] });
    bad({ type: "list", label: "L", rows: n(13, row) });
  });
  it("timeline 1-10 rows, at most one now", () => {
    const t = (i: number) => ({ ...row(i), time: "9:00" });
    ok({ type: "timeline", label: "T", rows: n(10, t) });
    bad({ type: "timeline", label: "T", rows: [] });
    bad({ type: "timeline", label: "T", rows: n(11, t) });
    ok({ type: "timeline", label: "T", rows: [{ ...t(1), now: true }, t(2)] });
    bad({ type: "timeline", label: "T", rows: [{ ...t(1), now: true }, { ...t(2), now: true }] });
    bad({ type: "timeline", label: "T", rows: [row()] });
  });
  it("progress 1-6 items, 0 <= now <= max", () => {
    const p = (now: number, max = 5) => ({ label: "Beta", now, max, value: "2 of 5" });
    ok({ type: "progress", label: "P", items: n(6, () => p(2)) });
    bad({ type: "progress", label: "P", items: [] });
    bad({ type: "progress", label: "P", items: n(7, () => p(2)) });
    ok({ type: "progress", label: "P", items: [p(0), p(5)] });
    bad({ type: "progress", label: "P", items: [p(6)] });
    bad({ type: "progress", label: "P", items: [p(-1)] });
  });
  it("table 2-6 cols, 1-12 rows, rectangular, one pick, <= 200 cells", () => {
    const t = (cols: number, rows: number) => ({ type: "table", label: "T", cols: n(cols, (i) => `c${i}`), rows: n(rows, () => ({ cells: n(cols, (i) => `v${i}`) })) });
    ok(t(2, 1));
    ok(t(6, 12));
    bad(t(1, 1));
    bad(t(7, 1));
    bad(t(2, 0));
    bad(t(2, 13));
    bad({ ...t(3, 2), rows: [{ cells: ["a", "b", "c"] }, { cells: ["a", "b"] }] });
    ok({ ...t(2, 2), rows: [{ cells: ["a", "b"], pick: true }, { cells: ["c", "d"] }] });
    bad({ ...t(2, 2), rows: [{ cells: ["a", "b"], pick: true }, { cells: ["c", "d"], pick: true }] });
    // 200 cells is above the 6x12 shape caps, so the width and row limits are what hold it.
    expect(6 * 12).toBeLessThanOrEqual(200);
  });
  it("bars 2-12, one highlight, aria required, tenths 0-10", () => {
    const b = (k: number) => n(k, (i) => [`b${i}`, 5]);
    const bars = (list: unknown[], aria = "Values") => ({ type: "bars", label: "B", aria, bars: list });
    ok(bars(b(2)));
    ok(bars(b(12)));
    bad(bars(b(1)));
    bad(bars(b(13)));
    ok(bars([["a", 3, true], ["b", 4]]));
    bad(bars([["a", 3, true], ["b", 4, true]]));
    bad(bars(b(2), ""));
    bad({ type: "bars", label: "B", bars: b(2) });
    bad(bars([["a", 11], ["b", 4]]));
    bad(bars([["a", 1.5], ["b", 4]]));
  });
  it("choice 2-4 options plus confirm", () => {
    const opt = (i: number) => ({ id: `o${i}`, title: `Option ${i}` });
    const c = (k: number) => ({ type: "choice", id: "c", label: "Pick", options: n(k, opt), confirm: { label: "Confirm", done: "Chosen" } });
    ok(c(2));
    ok(c(4));
    bad(c(1));
    bad(c(5));
    const { confirm: _confirm, ...noConfirm } = c(2);
    bad(noConfirm);
  });
  it("diff one file, 1-12 lines, with act", () => {
    const d = (k: number) => ({ type: "diff", id: "d", label: "Edit", file: "docs/plan.md", lines: n(k, (i) => ({ n: String(i), text: "line" })), act: { label: "Approve", done: "Approved", skipDone: "Not now" } });
    ok(d(1));
    ok(d(12));
    bad(d(0));
    bad(d(13));
    const { act: _act, ...noAct } = d(1);
    bad(noAct);
    bad({ ...d(1), file: undefined });
  });
  it("quote <= 280 with cite", () => {
    ok({ type: "quote", text: "a".repeat(280), cite: "notes.md" });
    bad({ type: "quote", text: "a".repeat(281), cite: "notes.md" });
    bad({ type: "quote", text: "ok" });
    bad({ type: "quote", text: "ok", cite: "" });
  });
  it("sources 1-6, suggest 1-3", () => {
    ok({ type: "sources", items: n(6, String) });
    bad({ type: "sources", items: [] });
    bad({ type: "sources", items: n(7, String) });
    ok({ type: "suggest", items: n(3, String) });
    bad({ type: "suggest", items: [] });
    bad({ type: "suggest", items: n(4, String) });
  });
  it("rejects unknown block types and unknown fields", () => {
    bad({ type: "carousel", items: [] });
    bad({ type: "text", text: "hi", style: "color:red" });
    bad({ type: "list", label: "L", rows: [{ ...row(), color: "red" }] });
    bad({ type: "list", label: "L", rows: [{ ...row(), act: { label: "Run", intent: "exec", done: "Done" } }] });
    expect(validateAnswer({ ...answer([headline]), extra: 1 }).ok).toBe(false);
    expect(validateAnswer({ v: 3, title: "x", blocks: [headline] }).ok).toBe(false);
  });
});

describe("composition", () => {
  const sources = { type: "sources", items: ["a.md"] };
  const suggest = { type: "suggest", items: ["Next?"] };
  const text = { type: "text", text: "Context." };
  const act = (primary: boolean) => ({ id: "x", title: "T", act: { label: "Do", intent: "approve", done: "Done", primary } });
  const diff = { type: "diff", id: "d", label: "Edit", file: "a.md", lines: [{ text: "x" }], act: { label: "Approve", done: "ok", skipDone: "no" } };
  const choice = { type: "choice", id: "c", label: "Pick", options: [{ id: "a", title: "A" }, { id: "b", title: "B" }], confirm: { label: "Confirm", done: "Chosen" } };
  const accepts = (blocks: unknown[]) => expect(validateAnswer(answer(blocks)).ok).toBe(true);
  const rejects = (blocks: unknown[]) => expect(validateAnswer(answer(blocks)).ok).toBe(false);

  it("headline first and exactly once", () => {
    accepts([headline]);
    rejects([text, headline]);
    rejects([headline, headline]);
    rejects([text]);
    rejects([]);
  });
  it("sources then suggest last", () => {
    accepts([headline, text, sources, suggest]);
    accepts([headline, sources]);
    accepts([headline, suggest]);
    rejects([headline, suggest, sources]);
    rejects([headline, sources, text]);
    rejects([headline, suggest, text]);
    rejects([headline, sources, sources]);
  });
  it("at most 10 blocks", () => {
    accepts([headline, ...n(9, () => text)]);
    rejects([headline, ...n(10, () => text)]);
  });
  it("at most one primary action, one choice, one diff", () => {
    const list = (rows: unknown[]) => ({ type: "list", label: "L", rows });
    accepts([headline, list([act(true), act(false)])]);
    rejects([headline, list([act(true), act(true)])]);
    rejects([headline, list([act(true)]), list([act(true)])]);
    accepts([headline, choice]);
    rejects([headline, choice, choice]);
    accepts([headline, diff]);
    rejects([headline, diff, diff]);
  });
  it("reports the broken rule", () => {
    const result = validateAnswer(answer([text]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("headline");
  });
});

describe("plain text content", () => {
  const rejectedStrings = ["<b>bold</b>", "<script>x</script>", "[plan](docs/plan.md)", "![img](a.png)", "see https://example.com", "www.example.com", "**bold**", "`code`", "# Heading", "&amp;", "javascript:alert(1)", "mailto:a@b.co", "data:text/html,x", "ftp://host/file", "__bold__ text", "~~gone~~"];
  for (const value of rejectedStrings) {
    it(`rejects ${value}`, () => {
      expect(containsMarkup(value)).toBe(true);
      bad({ type: "headline", text: value });
      bad({ type: "list", label: "L", rows: [{ id: "r", title: "T", sub: value }] });
      bad({ type: "sources", items: [value] });
    });
  }
  it("treats diff file and line text as literal text", () => {
    const diff = (file: string, text: string) => ({ type: "diff", id: "d", label: "E", file, lines: [{ text }], act: { label: "A", done: "d", skipDone: "s" } });
    ok(diff("a.md", "<b>bold</b> [x](y) `code` https://a.b"));
    ok(diff("src/<Tag/>.tsx", "x"));
    bad(diff("", "x"));
  });
  const ordinary: Array<[string, unknown]> = [
    ["Data: 1,284 rows", { type: "text", text: "Data: 1,284 rows" }],
    ["File: notes.md", { type: "text", text: "File: notes.md" }],
    ["src/__init__.py", { type: "text", text: "src/__init__.py" }],
    ["**kwargs", { type: "text", text: "Pass **kwargs through" }],
    ["> Keep Friday light.", { type: "quote", text: "> Keep Friday light.", cite: "Sam" }],
    ["## Beta in a diff line", { type: "diff", id: "d", label: "E", file: "README.md", lines: [{ text: "## Beta", ins: true }], act: { label: "A", done: "d", skipDone: "s" } }],
    ["<Tag/> in a diff line", { type: "diff", id: "d", label: "E", file: "App.tsx", lines: [{ text: "<Tag/>", ins: true }], act: { label: "A", done: "d", skipDone: "s" } }],
  ];
  for (const [name, block] of ordinary) it(`accepts ${name}`, () => ok(block));
  it("trims before the minimum length", () => bad({ type: "headline", text: "   " }));
  it("accepts ordinary text", () => {
    for (const value of ["Tue 20 Oct · 3h 30m", "−0.3 pts", "docs/plan.md", "Is 3 < 5 and 7 > 2?", "Mai & Tom"]) expect(containsMarkup(value)).toBe(false);
    ok({ type: "diff", id: "d", label: "E", file: "a.md", lines: [{ text: "" }], act: { label: "A", done: "d", skipDone: "s" } });
  });
});

describe("checkAnswer", () => {
  const good = { v: 2, title: "Today", blocks: [headline] };
  it("passes a valid answer", () => expect(checkAnswer(good).issues).toEqual([]));
  it("replaces a broken block with a fallback instead of rejecting", () => {
    const result = checkAnswer({ ...good, blocks: [headline, { type: "text", text: "<b>x</b>" }, { type: "mystery" }] });
    expect(result.issues).toEqual([]);
    expect(result.blocks.map((b) => b.type)).toEqual(["headline", "fallback", "fallback"]);
    expect(result.blockIssues).toHaveLength(2);
    expect(result.blockIssues[0]).toMatch(/^blocks\.1 \(text\): text: Plain text only/);
    expect(result.blockIssues[1]).toStartWith("blocks.2 (mystery): ");
  });
  it("reports composition failures, including more than 10 blocks", () => {
    expect(checkAnswer({ ...good, blocks: [{ type: "text", text: "x" }] }).issues.join(" ")).toContain("headline");
    expect(checkAnswer({ ...good, blocks: [headline, ...n(10, () => ({ type: "text", text: "x" }))] }).issues.join(" ")).toContain("at most 10");
    expect(checkAnswer({ ...good, blocks: [{ type: "text", text: "<b>" }] }).issues.join(" ")).toContain("headline");
  });
  it("reports envelope problems", () => {
    expect(checkAnswer({ v: 1, title: " ", blocks: [] }).issues.length).toBe(3);
    expect(checkAnswer(undefined).issues.length).toBeGreaterThan(0);
  });
});

describe("hardened diff paths and hidden characters (final review)", () => {
  const diff = (file: string, text = "x") => ({ type: "diff", id: "d", label: "E", file, lines: [{ n: "1", text, ins: true }], act: { label: "A", done: "d", skipDone: "s" } });
  const accepted = (block: unknown) => expect(validateBlock(block).ok).toBe(true);
  const refused = (block: unknown) => expect(validateBlock(block).ok).toBe(false);

  it("accepts plain relative workspace paths", () => {
    for (const file of ["a.md", "docs/plan.md", "src/<Tag/>.tsx", ".github/workflows/ci.yml", "dir/.gitignore", "my file.txt"]) accepted(diff(file));
  });
  it("refuses paths that are not what they look like", () => {
    const traversal = "docs/plan.md/x/../x/../x/../../.git/config";
    for (const file of [traversal, "../a.md", "a/../b.md", "/etc/passwd", "C:/x", "a\\b.md", "./a.md", "a/./b.md", "a//b.md", "a/", " a.md", "a.md ", "a/b ./c", "e\u0301.md", "a\u202Eb.md", "a\u200Bb.md", "a\nb.md", "a\tb.md"]) refused(diff(file));
  });
  it("refuses any VCS metadata segment", () => {
    for (const file of [".git/config", "a/.git/hooks/pre-commit", ".GIT/config", ".hg/hgrc", "x/.svn/entries"]) refused(diff(file));
  });
  it("refuses bidi, zero-width and control characters in lines, tabs allowed", () => {
    for (const text of ["a\u202Eb", "a\u2066b", "a\u2069b", "a\u200Bb", "a\u200Db", "a\uFEFFb", "a\u0001b", "a\rb", "a\nb", "a\u007Fb"]) refused(diff("a.md", text));
    accepted(diff("a.md", "\tindented"));
  });
  it("refuses bidi and zero-width characters in every plain string", () => {
    refused({ type: "headline", text: "Pay \u202Ealice" });
    refused({ type: "text", text: "zero\u200Bwidth" });
    refused({ type: "sources", items: ["ok", "a\uFEFFb"] });
    refused({ type: "diff", id: "d", label: "E\u2067", file: "a.md", lines: [{ text: "x" }], act: { label: "A", done: "d", skipDone: "s" } });
    expect(checkAnswer({ v: 2, title: "T\u200B", blocks: [{ type: "headline", text: "H" }] }).issues.length).toBeGreaterThan(0);
  });
});

describe("plain-text false positives (final review)", () => {
  it("lets ordinary prose through", () => {
    for (const text of ["if x<y and y>z then", "AT&T; Verizon", "# 1 priority is hiring", "a < b > c", "R&D; and Q&A;", "5 < 6"]) expect(containsMarkup(text)).toBe(false);
  });
  it("still refuses tags, entities and headings", () => {
    for (const text of ["<b>bold</b>", "</div>", "<img src=x onerror=1>", "<br/>", "<!-- c -->", "<a href=\"x\">y</a>", "fish &amp; chips", "&#60;script", "&#x3c;", "&nbsp;", "# Title", "## Beta", "intro\n# Title", "###### Deep"]) expect(containsMarkup(text)).toBe(true);
  });
});

describe("repairComposition", () => {
  const choice = (id: string) => ({ type: "choice", id, label: "Pick", options: [{ id: "a", title: "A" }, { id: "b", title: "B" }], confirm: { label: "Use", done: "Chosen" } });
  const row = (id: string) => ({ id, title: `Task ${id}`, act: { label: "Mark done", intent: "approve", done: "Done", primary: true } });
  const checked = (blocks: unknown[]) => checkAnswer({ v: 2, title: "Interactive demo", blocks }).blocks;

  it("leaves a valid composition unchanged", () => {
    const blocks = checked([{ type: "headline", text: "H" }, { type: "text", text: "x" }, { type: "suggest", items: ["More"] }]);
    expect(repairComposition(blocks, "T")).toEqual(blocks);
  });

  it("brings an interactive demo that breaks every rule within them", () => {
    const blocks = checked([
      { type: "sources", items: ["a.md"] },
      { type: "list", label: "Checklist", rows: [row("1"), row("2"), row("3")] },
      choice("c1"),
      { type: "headline", text: "Second headline" },
      choice("c2"),
      { type: "headline", text: "Late headline" },
    ]);
    expect(compositionIssues(blocks).length).toBeGreaterThan(0);
    const repaired = repairComposition(blocks, "Interactive demo");
    expect(compositionIssues(repaired)).toEqual([]);
    expect(repaired.map((block) => block.type)).toEqual(["headline", "list", "choice", "fallback", "text", "sources"]);
    expect(repaired[0]).toEqual({ type: "headline", text: "Second headline" });
    const rows = (repaired[1] as { rows: Array<{ act?: { primary?: boolean } }> }).rows;
    expect(rows.map((r) => r.act?.primary ?? false)).toEqual([true, false, false]);
    expect(repaired.every((block) => block.type === "fallback" || validateBlock(block).ok)).toBe(true);
  });

  it("leads with the title when there is no headline, and keeps the cap", () => {
    const repaired = repairComposition(checked(Array.from({ length: 11 }, () => ({ type: "text", text: "x" }))), "Interactive demo");
    expect(repaired[0]).toEqual({ type: "headline", text: "Interactive demo" });
    expect(repaired).toHaveLength(10);
    expect(compositionIssues(repaired)).toEqual([]);
  });
});
