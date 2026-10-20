/**
 * Design guardrails (WAN-511): enforces the "Rules for app code" of the Proteus
 * design system over every app `*.css` and `*.tsx` under src/mainview (ds/ excluded).
 *
 * Test files (*.test.tsx) are not scanned.
 *
 * Rules, counted per file:
 *  - colour: hex, rgb(/rgba(/hsl(/hsla( or a named colour used as a CSS value
 *    (transparent, currentColor, inherit and system colours are allowed)
 *  - z-index: a number (only var(--z-...) is allowed)
 *  - scrollbar: scrollbar-width / scrollbar-color
 *  - style: `style={{` in TSX unless every key is an allowlisted custom property
 *  - outline: `outline: none|0` inside a :focus-visible rule
 *
 * BASELINE below is the allowlist of violations that existed when the guardrail
 * landed: file -> count per rule. The baseline ONLY SHRINKS. Each phase that
 * deletes old CSS must lower (or remove) its entries. The test passes when a
 * file's count is at or below its baseline, or the file is gone; it fails when a
 * count grows or a file that is not baselined has any violation.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "bun:test";

type Rule = "colour" | "z-index" | "scrollbar" | "style" | "outline";
type Counts = Partial<Record<Rule, number>>;

const BASELINE: Record<string, Counts> = {
  "index.css": { colour: 122, "z-index": 15 },
  "proteus.css": { colour: 81, "z-index": 8 },
};

/** Custom properties that may be set through `style={{ ... }}`. */
const STYLE_ALLOWLIST = new Set(["--pos", "--sx", "--sy"]);

const ROOT = new URL(".", import.meta.url).pathname;

const NAMED_COLOURS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown " +
    "burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan " +
    "darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid " +
    "darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet " +
    "deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro " +
    "ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow " +
    "lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
    "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine " +
    "mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise " +
    "mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab " +
    "orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru " +
    "pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan " +
    "teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path === join(ROOT, "ds") || entry.name === "node_modules") continue;
      out.push(...listFiles(path));
    } else if (/\.(css|tsx)$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

function stripComments(text: string, isCss: boolean): string {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, "");
  return isCss ? noBlock : noBlock.replace(/(^|[\s;,{(])\/\/[^\n]*/g, "$1");
}

const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0;

function scanCss(src: string): Counts {
  const text = stripComments(src, true);
  // Values only: drop quoted strings, url(), and var(--names) so names never match.
  const decls = [...text.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)].map(([, prop, value]) => ({
    prop: prop!,
    value: value!.replace(/"[^"]*"|'[^']*'|url\([^)]*\)|var\(\s*--[\w-]+/g, ""),
  }));
  let colour = 0;
  for (const { prop, value } of decls) {
    if (prop.startsWith("--") && !/^--(?!z-)/.test(prop)) continue;
    colour += count(value, /#[0-9a-fA-F]{3,8}\b/g) + count(value, /\b(?:rgba?|hsla?)\(/gi);
    for (const word of value.toLowerCase().match(/(?<![\w#-])[a-z]+(?![\w(-])/g) ?? []) {
      if (NAMED_COLOURS.has(word)) colour++;
    }
  }
  const outline = [...text.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)].filter(([, , body]) =>
    /outline\s*:\s*(?:none|0)\s*(?:;|$|!)/.test(body!.trim()),
  ).length;
  return {
    colour,
    "z-index": count(text, /z-index\s*:\s*-?\d/g),
    scrollbar: count(text, /scrollbar-(?:width|color)\s*:/g),
    outline,
  };
}

function scanTsx(src: string): Counts {
  const text = stripComments(src, false);
  let style = 0;
  for (const [, body] of text.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
    const keys = [...body!.matchAll(/(?:^|[,{])\s*["']?(-{0,2}[\w-]+)["']?\s*:/g)].map((m) => m[1]!);
    if (keys.length === 0 || keys.some((key) => !STYLE_ALLOWLIST.has(key))) style++;
  }
  return {
    colour: count(text, /#[0-9a-fA-F]{3,8}\b/g) + count(text, /\b(?:rgba?|hsla?)\(/gi),
    "z-index": count(text, /z-?index\s*:\s*-?\d/gi),
    scrollbar: count(text, /scrollbar-(?:width|color)/g),
    style,
  };
}

function scanAll(): Record<string, Counts> {
  const result: Record<string, Counts> = {};
  for (const file of listFiles(ROOT)) {
    const rel = relative(ROOT, file);
    const counts = (file.endsWith(".css") ? scanCss : scanTsx)(readFileSync(file, "utf8"));
    const nonZero = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)) as Counts;
    if (Object.keys(nonZero).length > 0) result[rel] = nonZero;
  }
  return result;
}

describe("design-system guardrails", () => {
  const found = scanAll();

  it("has no new violations beyond the shrinking baseline", () => {
    const grown: string[] = [];
    for (const [file, counts] of Object.entries(found)) {
      for (const [rule, n] of Object.entries(counts) as [Rule, number][]) {
        const allowed = BASELINE[file]?.[rule] ?? 0;
        if (n > allowed) grown.push(`${file}: ${rule} ${n} > baseline ${allowed}`);
      }
    }
    expect(grown).toEqual([]);
  });

  it("prints remaining violations versus baseline", () => {
    const totals: Record<string, number> = {};
    let total = 0;
    for (const counts of Object.values(found)) {
      for (const [rule, n] of Object.entries(counts)) {
        totals[rule] = (totals[rule] ?? 0) + n;
        total += n;
      }
    }
    const baseTotal = Object.values(BASELINE).reduce(
      (sum, c) => sum + Object.values(c).reduce((a, b) => a + (b ?? 0), 0),
      0,
    );
    console.log(`design-rules: ${total} violations remain (baseline ${baseTotal}) ${JSON.stringify(totals)}`);
    expect(total).toBeLessThanOrEqual(baseTotal);
  });
});

describe("scanner self-test", () => {
  it("flags colour literals, numeric z-index and scrollbar properties in CSS", () => {
    expect(scanCss("a{color:#fff}").colour).toBe(1);
    expect(scanCss("a{color: rgba(0,0,0,.5)}").colour).toBe(1);
    expect(scanCss("a{color: red}").colour).toBe(1);
    expect(scanCss("a{ z-index: 3 }")["z-index"]).toBe(1);
    expect(scanCss("a{ scrollbar-width: thin }").scrollbar).toBe(1);
    expect(scanCss("a:focus-visible{ outline: none }").outline).toBe(1);
  });

  it("flags an inline style with a non-allowlisted key in TSX", () => {
    expect(scanTsx('const a = <p style={{ color: "red" }} />;').style).toBe(1);
    expect(scanTsx('const a = <p style={{ "--pos": 1 }} />;').style).toBe(0);
  });

  it("passes tokens and allowed keywords", () => {
    expect(scanCss("a{ z-index: var(--z-menu); color: currentColor; background: transparent; border-color: var(--line) }")).toEqual({
      colour: 0,
      "z-index": 0,
      scrollbar: 0,
      outline: 0,
    });
  });
});
