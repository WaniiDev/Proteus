import { createTool } from "@mastra/core/tools";
import { all, create, type MathNode } from "mathjs";
import { z } from "zod";

const math = create(all, { number: "number", predictable: true });
const MAX_EXPRESSION_LENGTH = 256;
const ALLOWED_NODE_TYPES = new Set(["ConstantNode", "ParenthesisNode", "OperatorNode", "FunctionNode", "SymbolNode"]);
const ALLOWED_SYMBOLS = new Set(["pi", "e"]);
const ALLOWED_FUNCTIONS = new Set(["abs", "sqrt", "cbrt", "exp", "log", "log10", "sin", "cos", "tan", "asin", "acos", "atan", "floor", "ceil", "round", "min", "max"]);
const ALLOWED_OPERATORS = new Set(["+", "-", "*", "/", "^", "%"]);
const OFFSET_TIMESTAMP = /(?:Z|[+-]\d{2}:\d{2})$/i;
const SAFE_UNIT = /^[A-Za-z0-9\s*/^()._-]{1,48}$/;
const CURRENCY_UNITS = /(?:\b(?:usd|eur|gbp|jpy|cny|thb|aud|cad|chf|inr|btc|eth)\b|[$€£¥฿])/i;

type ToolError = { ok: false; error: { code: string; message: string } };

function failure(code: string, message: string): ToolError {
  return { ok: false, error: { code, message } };
}

function timezoneOffset(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
  const offsetMinutes = Math.round((representedAsUtc - date.getTime()) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function validateExpression(expression: string): MathNode {
  if (!expression.trim()) throw new Error("Expression is required.");
  if (expression.length > MAX_EXPRESSION_LENGTH) throw new Error(`Expression must be ${MAX_EXPRESSION_LENGTH} characters or fewer.`);
  const node = math.parse(expression) as MathNode;
  node.traverse((child) => {
    if (!ALLOWED_NODE_TYPES.has(child.type)) throw new Error(`${child.type} is not allowed.`);
    if (child.type === "SymbolNode") {
      const name = (child as unknown as { name: string }).name;
      if (!ALLOWED_SYMBOLS.has(name) && !ALLOWED_FUNCTIONS.has(name)) throw new Error(`Unknown symbol ${name}.`);
    }
    if (child.type === "FunctionNode") {
      const name = (child as unknown as { fn: { name?: string } }).fn.name;
      if (!name || !ALLOWED_FUNCTIONS.has(name)) throw new Error(`Function ${name ?? "expression"} is not allowed.`);
    }
    if (child.type === "OperatorNode" && !ALLOWED_OPERATORS.has((child as unknown as { op: string }).op)) throw new Error(`Operator ${(child as unknown as { op: string }).op} is not allowed.`);
  });
  return node;
}

const errorSchema = z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) });

export function createWorkingTools(options: { now?: () => Date } = {}) {
  const now = options.now ?? (() => new Date());

  const getDatetime = createTool({
    id: "get_datetime",
    description: "Get an exact date and time in an IANA timezone, optionally converting an offset-aware ISO timestamp.",
    strict: true,
    inputSchema: z.object({
      timestamp: z.string().max(64).optional().describe("ISO 8601 timestamp including Z or a numeric UTC offset"),
      timezone: z.string().max(64).optional().describe("IANA timezone such as Asia/Bangkok; defaults to the operating-system timezone"),
    }),
    outputSchema: z.union([z.object({ ok: z.literal(true), utcIso: z.string(), unixMs: z.number(), timezone: z.string(), offset: z.string(), localDate: z.string(), localTime: z.string(), formatted: z.string() }), errorSchema]),
    mcp: { annotations: { title: "Date and time", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    execute: async ({ timestamp, timezone }) => {
      if (timestamp && !OFFSET_TIMESTAMP.test(timestamp)) return failure("timestamp_offset_required", "Supplied timestamps must include Z or an explicit UTC offset.");
      const date = timestamp ? new Date(timestamp) : now();
      if (!Number.isFinite(date.getTime())) return failure("invalid_timestamp", "The timestamp is not a valid ISO 8601 date and time.");
      const zone = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      try {
        const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
        const localTime = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(date);
        const formatted = new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle: "full", timeStyle: "long" }).format(date);
        return { ok: true as const, utcIso: date.toISOString(), unixMs: date.getTime(), timezone: zone, offset: timezoneOffset(date, zone), localDate, localTime, formatted };
      } catch {
        return failure("invalid_timezone", `Unknown IANA timezone: ${zone}`);
      }
    },
  });

  const calculate = createTool({
    id: "calculate",
    description: "Safely evaluate a bounded scalar arithmetic expression. Variables, assignments, collections, property access, imports, and custom units are not supported.",
    strict: true,
    inputSchema: z.object({ expression: z.string().max(MAX_EXPRESSION_LENGTH) }),
    outputSchema: z.union([z.object({ ok: z.literal(true), expression: z.string(), result: z.number(), formatted: z.string() }), errorSchema]),
    mcp: { annotations: { title: "Calculator", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    execute: async ({ expression }) => {
      try {
        const result = validateExpression(expression).compile().evaluate();
        if (typeof result !== "number" || !Number.isFinite(result)) return failure("non_scalar_result", "The result must be one finite real number.");
        return { ok: true as const, expression, result, formatted: math.format(result, { precision: 14 }) };
      } catch (error) {
        return failure("invalid_expression", error instanceof Error ? error.message : "The expression could not be evaluated.");
      }
    },
  });

  const convertUnits = createTool({
    id: "convert_units",
    description: "Convert a numeric value between compatible built-in physical units. Currency and custom units are not supported.",
    strict: true,
    inputSchema: z.object({ value: z.number().finite(), from: z.string().max(48), to: z.string().max(48) }),
    outputSchema: z.union([z.object({ ok: z.literal(true), value: z.number(), from: z.string(), to: z.string(), result: z.number(), formatted: z.string() }), errorSchema]),
    mcp: { annotations: { title: "Unit conversion", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    execute: async ({ value, from, to }) => {
      if (!SAFE_UNIT.test(from) || !SAFE_UNIT.test(to)) return failure("invalid_unit", "Units contain unsupported characters.");
      if (CURRENCY_UNITS.test(from) || CURRENCY_UNITS.test(to)) return failure("currency_unsupported", "Currency conversion requires live exchange-rate data and is not supported by this tool.");
      try {
        const converted = math.unit(value, from).to(to);
        const result = converted.toNumber(to);
        if (!Number.isFinite(result)) return failure("non_finite_result", "The conversion did not produce a finite number.");
        return { ok: true as const, value, from, to, result, formatted: `${math.format(result, { precision: 14 })} ${to}` };
      } catch (error) {
        return failure("incompatible_units", error instanceof Error ? error.message : "The units are unknown or incompatible.");
      }
    },
  });

  return { get_datetime: getDatetime, calculate, convert_units: convertUnits };
}

export type WorkingTools = ReturnType<typeof createWorkingTools>;
