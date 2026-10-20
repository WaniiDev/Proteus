/**
 * Incremental JSON for streamed tool input. `parsePartialJson` reads a prefix of a JSON document and returns a tree in
 * which every node says whether it is closed (fully received). Only closed nodes are safe to read: `closedValue`
 * returns the JS value of a closed node and `undefined` for an open one, so half-received values never leak.
 */
export type PartialNode =
  | { kind: "object"; entries: Array<[string, PartialNode]>; closed: boolean }
  | { kind: "array"; items: PartialNode[]; closed: boolean }
  | { kind: "string"; value: string; closed: boolean }
  | { kind: "literal"; value: unknown; closed: boolean };

class Invalid extends Error {}

const WS = new Set([" ", "\n", "\r", "\t"]);
const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

/** Parses a prefix of a JSON document. Returns undefined when the prefix is empty or can never become valid JSON. */
export function parsePartialJson(text: string): PartialNode | undefined {
  let pos = 0;
  const skip = () => {
    while (pos < text.length && WS.has(text[pos]!)) pos++;
  };
  const open = (): PartialNode => ({ kind: "literal", value: undefined, closed: false });

  function readString(): { value: string; closed: boolean } {
    pos++; // opening quote
    let value = "";
    while (pos < text.length) {
      const char = text[pos]!;
      if (char === '"') {
        pos++;
        return { value, closed: true };
      }
      if (char === "\\") {
        const next = text[pos + 1];
        if (next === undefined) break;
        if (next === "u") {
          const hex = text.slice(pos + 2, pos + 6);
          if (hex.length < 4) break;
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Invalid();
          value += String.fromCharCode(Number.parseInt(hex, 16));
          pos += 6;
          continue;
        }
        const mapped = ESCAPES[next];
        if (mapped === undefined) throw new Invalid();
        value += mapped;
        pos += 2;
        continue;
      }
      value += char;
      pos++;
    }
    pos = text.length;
    return { value, closed: false };
  }

  function readValue(): PartialNode {
    skip();
    if (pos >= text.length) return open();
    const char = text[pos]!;
    if (char === '"') return { kind: "string", ...readString() };
    if (char === "{") return readObject();
    if (char === "[") return readArray();
    const start = pos;
    while (pos < text.length && !WS.has(text[pos]!) && !",]}".includes(text[pos]!)) pos++;
    const word = text.slice(start, pos);
    // A number or keyword is only complete once a delimiter follows it.
    const closed = pos < text.length;
    if (word === "true" || word === "false" || word === "null") return closed ? { kind: "literal", value: word === "null" ? null : word === "true", closed } : open();
    if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(word)) return closed ? { kind: "literal", value: Number(word), closed } : open();
    if (!closed && /^(t(r(ue?)?)?|f(a(l(se?)?)?)?|n(u(ll?)?)?|-|-?\d+\.?|-?\d+(\.\d+)?[eE][+-]?)?$/.test(word)) return open();
    throw new Invalid();
  }

  function readObject(): PartialNode {
    pos++;
    const node: Extract<PartialNode, { kind: "object" }> = { kind: "object", entries: [], closed: false };
    for (;;) {
      skip();
      if (pos >= text.length) return node;
      if (text[pos] === "}") {
        pos++;
        node.closed = true;
        return node;
      }
      if (text[pos] === ",") {
        pos++;
        continue;
      }
      if (text[pos] !== '"') throw new Invalid();
      const key = readString();
      if (!key.closed) return node;
      skip();
      if (pos >= text.length) return node;
      if (text[pos] !== ":") throw new Invalid();
      pos++;
      const value = readValue();
      const received = value.closed || value.kind === "object" || value.kind === "array" || (value.kind === "string" && value.value !== "");
      if (received) node.entries.push([key.value, value]);
      if (!value.closed) return node;
    }
  }

  function readArray(): PartialNode {
    pos++;
    const node: Extract<PartialNode, { kind: "array" }> = { kind: "array", items: [], closed: false };
    for (;;) {
      skip();
      if (pos >= text.length) return node;
      if (text[pos] === "]") {
        pos++;
        node.closed = true;
        return node;
      }
      if (text[pos] === ",") {
        pos++;
        continue;
      }
      const value = readValue();
      const received = value.closed || value.kind === "object" || value.kind === "array" || (value.kind === "string" && value.value !== "");
      if (received) node.items.push(value);
      if (!value.closed) return node;
    }
  }

  try {
    skip();
    if (pos >= text.length) return undefined;
    const root = readValue();
    return root.kind === "literal" && !root.closed ? undefined : root;
  } catch (error) {
    if (error instanceof Invalid) return undefined;
    throw error;
  }
}

/** The value of a closed node, or undefined while any part of it is still arriving. */
export function closedValue(node: PartialNode): unknown {
  if (!node.closed) return undefined;
  if (node.kind === "literal" || node.kind === "string") return node.value;
  if (node.kind === "array") return node.items.map(closedValue);
  return Object.fromEntries(node.entries.map(([key, value]) => [key, closedValue(value)]));
}

/** The entry of an object node by key. */
export function entryOf(node: PartialNode | undefined, key: string): PartialNode | undefined {
  if (node?.kind !== "object") return undefined;
  for (let index = node.entries.length - 1; index >= 0; index--) if (node.entries[index]![0] === key) return node.entries[index]![1];
  return undefined;
}
