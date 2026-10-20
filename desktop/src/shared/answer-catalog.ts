import { z } from "zod";

/**
 * Generative answer catalog v2 (ADR 0003). Shared by the backend tool and the renderer.
 * Every limit and composition rule from the ADR is enforced here, never left to the model.
 * Data shapes follow the design system's `AnswerBlock`, `AnswerRow`, `AnswerIntent` and `Tenths`.
 */

export const ANSWER_CATALOG_VERSION = 2;
export const ANSWER_MAX_BLOCKS = 10;
export const ANSWER_MAX_TABLE_CELLS = 200;

export const ANSWER_INTENTS = ["open", "reply", "approve", "choose", "skip"] as const;
export type AnswerIntent = (typeof ANSWER_INTENTS)[number];

const MARKUP_PATTERNS: RegExp[] = [
  /<\/[A-Za-z][A-Za-z0-9-]*\s*>/, // closing tag
  /<[A-Za-z][A-Za-z0-9-]*\s*\/?>/, // bare tag: <b>, <br/> ("x<y and y>z" is text)
  /<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w:.-]*)*\s+[A-Za-z_:][\w:.-]*\s*=[^<>]*>/, // tag with an attribute
  /<[!?][^>]*>/, // comments, doctype, processing instructions
  /!?\[[^\]]*\]\([^)]*\)/, // Markdown links and images
  /\[[^\]]+\]\s*\[[^\]]*\]/, // Markdown reference links
  /\b[a-z][a-z0-9+.-]*:\/\//i, // any scheme:// URL
  /\bjavascript:/i,
  /\b(?:mailto|data):\S/i, // "Data: 1,284 rows" is ordinary text, "data:text/html" is not
  /\bwww\./i,
  /`/, // code spans and fences
  /(?<![\w*])\*\*[^*\s][^*]*\*\*(?![\w*])/, // bold pair (a lone "**kwargs" is text)
  /(?<![\w/.])__[^_\s][^_]*__(?![\w.])/, // bold pair (src/__init__.py is text)
  /~~[^~\s][^~]*~~/, // strike pair
  /^[ \t]{0,3}#{1,6}[ \t]+\p{L}/mu, // headings ("# 1 priority is hiring" is text)
  /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,31});/i, // HTML entities ("AT&T; Verizon" is text)
];

/** True when the text contains markup, HTML, Markdown or a link. */
export function containsMarkup(text: string): boolean {
  return MARKUP_PATTERNS.some((pattern) => pattern.test(text));
}

/** Bidi controls (U+202A-202E, U+2066-2069) and zero-width characters (U+200B-200D, U+FEFF): they make text read differently from what it is. */
const HIDDEN_CHARS = /[\u202A-\u202E\u2066-\u2069\u200B-\u200D\uFEFF]/;
/** C0 controls (tab excluded), DEL and line breaks. */
const CONTROL_CHARS = /[\u0000-\u0008\u000A-\u001F\u007F]/;
const HIDDEN_MESSAGE = "No bidirectional or zero-width characters.";

const PLAIN_MESSAGE = "Plain text only: no markup, HTML, Markdown or links.";
/** A plain-text string: trimmed, non-empty, no markup, no links, no hidden characters. */
const plain = (max?: number) => {
  const trimmed = z.string().trim().min(1);
  return (max ? trimmed.max(max) : trimmed)
    .refine((value) => !containsMarkup(value), { message: PLAIN_MESSAGE })
    .refine((value) => !HIDDEN_CHARS.test(value), { message: HIDDEN_MESSAGE });
};
/** One line of a diff: shown escaped, so it may hold code and markup characters (and be blank, and hold a tab), but no hidden or control characters. */
const literalLine = z.string()
  .refine((value) => !HIDDEN_CHARS.test(value), { message: HIDDEN_MESSAGE })
  .refine((value) => !CONTROL_CHARS.test(value) && !value.includes("\r"), { message: "A line holds no control characters or line breaks." });

const VCS_DIRS = new Set([".git", ".hg", ".svn"]);
/**
 * A workspace-relative path that is exactly what it looks like: no absolute or drive paths, no `.`/`..`/empty segments,
 * no backslashes, nothing that changes under normalisation, no VCS metadata (`.git`, `.hg`, `.svn`) anywhere.
 */
export function isSafeDiffPath(file: string): boolean {
  if (!file || file !== file.trim() || file !== file.normalize("NFC")) return false;
  if (file.startsWith("/") || file.includes("\\") || /^[A-Za-z]:/.test(file)) return false;
  if (HIDDEN_CHARS.test(file) || CONTROL_CHARS.test(file) || file.includes("\t") || file.includes("\r")) return false;
  return file.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".." && !/[. ]$/.test(segment) && !VCS_DIRS.has(segment.toLowerCase()));
}
const diffPath = z.string().min(1).refine(isSafeDiffPath, { message: "A diff file is a plain relative workspace path." });

export const tenthsSchema = z.number().int().min(0).max(10);

const rowActSchema = z.object({
  label: plain(),
  intent: z.enum(ANSWER_INTENTS),
  primary: z.boolean().optional(),
  done: plain(),
}).strict();

const answerRowShape = {
  id: plain(),
  title: plain(),
  sub: plain().optional(),
  dot: z.literal("warn").optional(),
  tick: z.boolean().optional(),
  time: plain().optional(),
  act: rowActSchema.optional(),
};
export const answerRowSchema = z.object(answerRowShape).strict();

const timelineRowSchema = z.object({
  ...answerRowShape,
  time: plain(),
  past: z.boolean().optional(),
  now: z.boolean().optional(),
}).strict();

const atMostOne = <T>(items: T[], pick: (item: T) => unknown) => items.filter((item) => pick(item)).length <= 1;

export const headlineBlockSchema = z.object({ type: z.literal("headline"), text: plain(140) }).strict();
export const textBlockSchema = z.object({ type: z.literal("text"), text: plain(320) }).strict();

export const statsBlockSchema = z.object({
  type: z.literal("stats"),
  items: z.array(z.object({
    value: plain(),
    label: plain(),
    delta: plain().optional(),
    dir: z.enum(["up", "down", "flat"]).optional(),
    spark: z.array(tenthsSchema).min(2).max(12).optional(),
  }).strict().refine((item) => !item.spark || !!item.delta, { message: "A sparkline needs a delta.", path: ["spark"] })).min(1).max(3),
}).strict();

export const listBlockSchema = z.object({
  type: z.literal("list"),
  label: plain(),
  count: plain().optional(),
  rows: z.array(answerRowSchema).min(1).max(12),
}).strict();

export const timelineBlockSchema = z.object({
  type: z.literal("timeline"),
  label: plain(),
  count: plain().optional(),
  rows: z.array(timelineRowSchema).min(1).max(10).refine((rows) => atMostOne(rows, (row) => row.now), { message: "At most one row can be now." }),
}).strict();

export const progressBlockSchema = z.object({
  type: z.literal("progress"),
  label: plain(),
  count: plain().optional(),
  items: z.array(z.object({
    label: plain(),
    now: z.number().min(0),
    max: z.number().positive(),
    value: plain(),
    warn: z.boolean().optional(),
  }).strict().refine((item) => item.now <= item.max, { message: "now must be between 0 and max.", path: ["now"] })).min(1).max(6),
}).strict();

export const tableBlockSchema = z.object({
  type: z.literal("table"),
  label: plain(),
  cols: z.array(plain()).min(2).max(6),
  rows: z.array(z.object({ cells: z.array(plain()), pick: z.boolean().optional() }).strict()).min(1).max(12),
}).strict().superRefine((block, ctx) => {
  block.rows.forEach((row, index) => {
    if (row.cells.length !== block.cols.length) {
      ctx.addIssue({ code: "custom", message: "Every row must be exactly as wide as cols.", path: ["rows", index, "cells"] });
    }
  });
  if (!atMostOne(block.rows, (row) => row.pick)) ctx.addIssue({ code: "custom", message: "At most one row can be the pick.", path: ["rows"] });
  if (block.rows.reduce((total, row) => total + row.cells.length, 0) > ANSWER_MAX_TABLE_CELLS) {
    ctx.addIssue({ code: "custom", message: `A table has at most ${ANSWER_MAX_TABLE_CELLS} cells.`, path: ["rows"] });
  }
});

export const barsBlockSchema = z.object({
  type: z.literal("bars"),
  label: plain(),
  note: plain().optional(),
  aria: plain(),
  bars: z.array(z.union([z.tuple([plain(), tenthsSchema]), z.tuple([plain(), tenthsSchema, z.boolean()])])).min(2).max(12),
}).strict().superRefine((block, ctx) => {
  if (block.bars.filter((bar) => bar[2] === true).length > 1) ctx.addIssue({ code: "custom", message: "At most one bar can be highlighted.", path: ["bars"] });
});

export const choiceBlockSchema = z.object({
  type: z.literal("choice"),
  id: plain(),
  label: plain(),
  options: z.array(z.object({ id: plain(), title: plain(), sub: plain().optional(), tag: plain().optional() }).strict()).min(2).max(4),
  confirm: z.object({ label: plain(), done: plain() }).strict(),
}).strict();

export const diffBlockSchema = z.object({
  type: z.literal("diff"),
  id: plain(),
  label: plain(),
  file: diffPath,
  where: plain().optional(),
  lines: z.array(z.object({ n: plain().optional(), text: literalLine, del: z.boolean().optional(), ins: z.boolean().optional() }).strict()).min(1).max(12),
  act: z.object({ label: plain(), done: plain(), skipDone: plain() }).strict(),
}).strict();

export const quoteBlockSchema = z.object({ type: z.literal("quote"), text: plain(280), cite: plain() }).strict();
export const sourcesBlockSchema = z.object({ type: z.literal("sources"), items: z.array(plain()).min(1).max(6) }).strict();
export const suggestBlockSchema = z.object({ type: z.literal("suggest"), items: z.array(plain()).min(1).max(3) }).strict();

export const answerBlockSchema = z.discriminatedUnion("type", [
  headlineBlockSchema,
  textBlockSchema,
  statsBlockSchema,
  listBlockSchema,
  timelineBlockSchema,
  progressBlockSchema,
  tableBlockSchema,
  barsBlockSchema,
  choiceBlockSchema,
  diffBlockSchema,
  quoteBlockSchema,
  sourcesBlockSchema,
  suggestBlockSchema,
]);

export type AnswerBlock = z.infer<typeof answerBlockSchema>;
export type AnswerBlockType = AnswerBlock["type"];
export type AnswerRow = z.infer<typeof answerRowSchema>;
export type Tenths = z.infer<typeof tenthsSchema>;

/** Shape only: version, title and 1-10 valid blocks. Used as the tool's input schema. */
export const answerShapeSchema = z.object({
  v: z.literal(ANSWER_CATALOG_VERSION),
  title: plain(),
  blocks: z.array(answerBlockSchema).min(1).max(ANSWER_MAX_BLOCKS),
}).strict();

/** Composition rules, checked once the tool call ends. Returns one message per broken rule. */
export type CheckedBlock = AnswerBlock | { type: "fallback" };

/** Blocks that broke their own limits are `fallback` entries: they count toward the total but not toward order or counts. */
export function compositionIssues(all: readonly CheckedBlock[]): string[] {
  const issues: string[] = [];
  const blocks = all.filter((block): block is AnswerBlock => block.type !== "fallback");
  const types = blocks.map((block) => block.type);
  const count = (type: AnswerBlockType) => types.filter((t) => t === type).length;
  if (all.length > ANSWER_MAX_BLOCKS) issues.push(`An answer has at most ${ANSWER_MAX_BLOCKS} blocks.`);
  if (types[0] !== "headline") issues.push("The first block must be the headline.");
  if (count("headline") !== 1) issues.push("There must be exactly one headline.");
  const tail = types.filter((t) => t === "sources" || t === "suggest");
  if (count("sources") > 1 || count("suggest") > 1) issues.push("Use at most one sources block and one suggest block.");
  const tailStart = types.length - tail.length;
  const tailInPlace = types.slice(tailStart).every((t) => t === "sources" || t === "suggest");
  const tailOrdered = tail.join(",") === "suggest" || tail.join(",") === "sources" || tail.join(",") === "sources,suggest" || tail.length === 0;
  if (!tailInPlace || !tailOrdered) issues.push("sources, then suggest, must be the last blocks.");
  if (count("choice") > 1) issues.push("An answer has at most one choice.");
  if (count("diff") > 1) issues.push("An answer has at most one diff.");
  const primaries = blocks.reduce((total, block) => {
    if (block.type !== "list" && block.type !== "timeline") return total;
    return total + (block.rows as AnswerRow[]).filter((row) => row.act?.primary).length;
  }, 0);
  if (primaries > 1) issues.push("An answer has at most one primary action.");
  return issues;
}

/** The full answer: shape plus composition. */
export const answerSchema = answerShapeSchema.superRefine((answer, ctx) => {
  for (const message of compositionIssues(answer.blocks)) ctx.addIssue({ code: "custom", message, path: ["blocks"] });
});

export type Answer = z.infer<typeof answerShapeSchema>;
export type AnswerValidation<T> = { ok: true; value: T } | { ok: false; error: string };

function describe(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.length ? issue.path.join(".") : "answer"}: ${issue.message}`)
    .join("; ");
}

/** Validate one block against its own limits. A failing block is replaced by a fallback line, not the answer. */
export function validateBlock(block: unknown): AnswerValidation<AnswerBlock> {
  const parsed = answerBlockSchema.safeParse(block);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: describe(parsed.error) };
}

/** Validate a complete answer: every block plus the composition rules. */
export function validateAnswer(answer: unknown): AnswerValidation<Answer> {
  const parsed = answerSchema.safeParse(answer);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: describe(parsed.error) };
}

/**
 * The structural shape the model's tool call must have. Deliberately loose: block limits and composition are checked in
 * `checkAnswer`, so a bad block becomes a fallback and a bad composition gets one retry, instead of failing input validation.
 */
export const answerInputSchema = z.object({
  v: z.number().describe(`Catalog version, always ${ANSWER_CATALOG_VERSION}.`),
  title: z.string().describe("Short plain-text title of the answer."),
  blocks: z.array(z.object({ type: z.string() }).passthrough()).describe(`1-${ANSWER_MAX_BLOCKS} blocks, each with a type.`),
}).passthrough();

export type AnswerCheck = { blocks: CheckedBlock[]; issues: string[] };

/** Check a tool input: broken blocks become fallbacks; the issues are composition failures that need a retry. */
export function checkAnswer(input: unknown): AnswerCheck {
  const record = input && typeof input === "object" ? (input as { v?: unknown; title?: unknown; blocks?: unknown }) : {};
  const issues: string[] = [];
  if (record.v !== ANSWER_CATALOG_VERSION) issues.push(`v must be ${ANSWER_CATALOG_VERSION}.`);
  const title = plain().safeParse(record.title);
  if (!title.success) issues.push(`title: ${title.error.issues[0]?.message ?? "invalid"}`);
  const raw = Array.isArray(record.blocks) ? record.blocks : [];
  if (raw.length === 0) issues.push("An answer needs at least one block.");
  const blocks: CheckedBlock[] = raw.map((block) => {
    const result = validateBlock(block);
    return result.ok ? result.value : { type: "fallback" };
  });
  return { blocks, issues: [...issues, ...(raw.length ? compositionIssues(blocks) : [])] };
}
