import { describe, expect, it } from "bun:test";
import { createWorkingTools } from "./working-tools";

async function run(tool: unknown, input: unknown): Promise<any> {
  const execute = (tool as { execute?: (input: any, context: any) => Promise<unknown> }).execute;
  if (!execute) throw new Error("Tool is missing execute");
  return execute(input, {});
}

describe("working utility tools", () => {
  const tools = createWorkingTools({ now: () => new Date("2026-08-06T03:00:00.000Z") });

  it("reports deterministic local and UTC time", async () => {
    const result = await run(tools.get_datetime, { timezone: "Asia/Bangkok" });
    expect(result).toMatchObject({ ok: true, utcIso: "2026-08-06T03:00:00.000Z", timezone: "Asia/Bangkok", offset: "+07:00" });
    expect(result.localTime).toBe("10:00:00");
  });

  it("requires an offset for supplied timestamps", async () => {
    expect(await run(tools.get_datetime, { timestamp: "2026-08-06T10:00:00", timezone: "Asia/Bangkok" })).toMatchObject({ ok: false, error: { code: "timestamp_offset_required" } });
  });

  it("evaluates scalar arithmetic and blocks executable expression features", async () => {
    expect(await run(tools.calculate, { expression: "sqrt(81) + 2 ^ 3" })).toMatchObject({ ok: true, result: 17 });
    expect(await run(tools.calculate, { expression: "x = 2" })).toMatchObject({ ok: false, error: { code: "invalid_expression" } });
    expect(await run(tools.calculate, { expression: "[1, 2, 3]" })).toMatchObject({ ok: false });
  });

  it("converts compatible physical units and rejects currency", async () => {
    expect(await run(tools.convert_units, { value: 1, from: "km", to: "m" })).toMatchObject({ ok: true, result: 1000 });
    expect(await run(tools.convert_units, { value: 10, from: "USD", to: "THB" })).toMatchObject({ ok: false, error: { code: "currency_unsupported" } });
  });
});
