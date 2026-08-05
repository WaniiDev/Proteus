import { describe, expect, it } from "bun:test";
import type { ProcessInputStepArgs, ProcessOutputStepArgs } from "@mastra/core/processors";
import { NativeToolCallGuard, type NativeToolCallViolation } from "./native-tool-call-guard";

const inputArgs = (state: Record<string, unknown>, tools: Record<string, unknown>) => ({ state, tools }) as ProcessInputStepArgs<NativeToolCallViolation>;
const outputArgs = (state: Record<string, unknown>, overrides: Partial<ProcessOutputStepArgs<NativeToolCallViolation>> = {}) => ({
  state,
  text: "A normal response.",
  toolCalls: [],
  retryCount: 0,
  messages: [],
  abort: () => { throw new Error("unexpected abort"); },
  ...overrides,
}) as unknown as ProcessOutputStepArgs<NativeToolCallViolation>;

describe("NativeToolCallGuard", () => {
  it("learns the exact tool names Mastra assembled for the current step", () => {
    const guard = new NativeToolCallGuard();
    const state: Record<string, unknown> = {};
    expect(guard.processInputStep(inputArgs(state, { submit_plan: {}, write_plan: {}, task_write: {} }))).toBeUndefined();
    expect(state.availableToolNames).toEqual(["submit_plan", "task_write", "write_plan"]);
  });

  it("requests a native retry when an available tool is emitted as text", () => {
    const guard = new NativeToolCallGuard();
    const state: Record<string, unknown> = {};
    guard.processInputStep(inputArgs(state, { write_plan: {} }));
    let violation: unknown;

    expect(() => guard.processOutputStep(outputArgs(state, {
      text: "I'll draft it.\n\nto=write_plan (json {\"path\":\"plan.md\"})",
      abort: (reason, options) => {
        violation = { reason, options };
        throw new Error("aborted for retry");
      },
    }))).toThrow("aborted for retry");
    expect(violation).toMatchObject({
      reason: expect.stringContaining("native tool-call interface"),
      options: { retry: true, metadata: { violation: "textual-tool-imitation", toolName: "write_plan" } },
    });
  });

  it("allows normal text, unknown names, and genuine native tool calls", () => {
    const guard = new NativeToolCallGuard();
    const state: Record<string, unknown> = {};
    guard.processInputStep(inputArgs(state, { write_plan: {} }));
    expect(guard.processOutputStep(outputArgs(state, { text: "The plan is ready." }))).toEqual([]);
    expect(guard.processOutputStep(outputArgs(state, { text: "to=unknown_tool (json {})" }))).toEqual([]);
    expect(guard.processOutputStep(outputArgs(state, { text: "to=write_plan", toolCalls: [{ toolName: "write_plan" }] as never[] }))).toEqual([]);
  });

  it("does not let an unrelated native call hide a textual tool imitation", () => {
    const guard = new NativeToolCallGuard();
    const state: Record<string, unknown> = {};
    guard.processInputStep(inputArgs(state, { read_plan: {}, write_plan: {} }));
    expect(() => guard.processOutputStep(outputArgs(state, {
      text: "to=write_plan (json {})",
      toolCalls: [{ toolName: "read_plan" }] as never[],
      abort: () => { throw new Error("blocked mismatched pseudo-call"); },
    }))).toThrow("blocked mismatched pseudo-call");
  });
});
