import { describe, expect, test } from "bun:test";
import { closedValue, entryOf, parsePartialJson } from "./partial-json";

const doc = { a: "x\"y\\zé", b: [1, -2.5e3, true, null, { c: [] }], d: { e: "f" } };
const text = JSON.stringify(doc);

describe("partial JSON", () => {
  test("every prefix parses without throwing and the full text round-trips", () => {
    for (let end = 0; end <= text.length; end++) parsePartialJson(text.slice(0, end));
    const full = parsePartialJson(text)!;
    expect(full.closed).toBe(true);
    expect(closedValue(full)).toEqual(doc);
  });

  test("an open node never exposes a value", () => {
    const node = parsePartialJson('{"a":"abc","b":[{"x":1},{"x":2')!;
    expect(closedValue(node)).toBeUndefined();
    expect(closedValue(entryOf(node, "a")!)).toBe("abc");
    const items = (entryOf(node, "b") as { items: Parameters<typeof closedValue>[0][] }).items;
    expect(items.map(closedValue)).toEqual([{ x: 1 }, undefined]);
  });

  test("numbers and keywords close only at a delimiter", () => {
    expect(closedValue(entryOf(parsePartialJson('{"n":12')!, "n") ?? { kind: "literal", value: undefined, closed: false })).toBeUndefined();
    expect(closedValue(entryOf(parsePartialJson('{"n":12,')!, "n")!)).toBe(12);
    expect(entryOf(parsePartialJson('{"t":tr')!, "t")).toBeUndefined();
  });

  test("a cut escape or unicode sequence stays open", () => {
    expect(closedValue(entryOf(parsePartialJson('{"s":"a\\u00')!, "s") ?? { kind: "literal", value: 1, closed: false })).toBeUndefined();
    expect(closedValue(entryOf(parsePartialJson('{"s":"a\\u00e9"')!, "s")!)).toBe("aé");
  });

  test("invalid or empty input yields undefined", () => {
    expect(parsePartialJson("")).toBeUndefined();
    expect(parsePartialJson("  ")).toBeUndefined();
    expect(parsePartialJson("{oops}")).toBeUndefined();
    expect(parsePartialJson('{"a" 1}')).toBeUndefined();
  });
});
