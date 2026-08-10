import { describe, expect, test } from "bun:test";
import type { RuntimeSnapshot, RuntimeSnapshotDecodeReport, RuntimeSnapshotEnvelope } from "../shared/contracts";
import { encodeRuntimeSnapshot } from "../shared/runtime-snapshot-codec";
import { createRuntimeSnapshotTransport } from "./runtime-snapshot-transport";

function snapshot(revision: number): RuntimeSnapshot {
  return {
    revision,
    status: "ready",
    credential: { configured: true, verified: true },
    providerAuth: null,
    providers: [],
    models: [],
    selectedProviderId: "openrouter",
    selectedModelId: "openrouter/auto",
    selectedReasoningEffort: null,
    projects: [],
    activeWorkspace: { binding: { kind: "app" }, label: "Proteus workspace", availability: "ready" },
    threads: [],
    activeThreadId: null,
    retryMessageId: null,
    messages: [],
    events: [],
    interactions: [],
    workbench: { status: "idle", tasks: [], pendingInteractions: [], queuedFollowUpCount: 0, tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
    activeRun: null,
    error: null,
  };
}

const invalidEnvelope = { version: 1, encoding: "utf8-base64-json", data: "%%%%" } as unknown as RuntimeSnapshotEnvelope;

describe("runtime snapshot transport", () => {
  test("applies revision zero as the first valid snapshot", () => {
    const applied: number[] = [];
    const transport = createRuntimeSnapshotTransport({
      fetchBootstrap: async () => encodeRuntimeSnapshot(snapshot(0)),
      reportDecodeFailure: () => undefined,
      onSnapshot: (next) => applied.push(next.revision),
      onTransportError: () => undefined,
      onRuntimeUnavailable: () => undefined,
    });

    expect(transport.accept(encodeRuntimeSnapshot(snapshot(0)), "runtime.bootstrap")).toBeTrue();
    expect(applied).toEqual([0]);
  });

  test("keeps the last valid snapshot and performs one automatic recovery", async () => {
    const applied: number[] = [];
    const reports: RuntimeSnapshotDecodeReport[] = [];
    const errors: Array<string | null> = [];
    let bootstrapCalls = 0;
    const transport = createRuntimeSnapshotTransport({
      fetchBootstrap: async () => {
        bootstrapCalls += 1;
        return encodeRuntimeSnapshot(snapshot(2));
      },
      reportDecodeFailure: (report) => reports.push(report),
      onSnapshot: (next) => applied.push(next.revision),
      onTransportError: (message) => errors.push(message),
      onRuntimeUnavailable: () => undefined,
    });

    expect(transport.accept(encodeRuntimeSnapshot(snapshot(1)), "runtime.bootstrap")).toBeTrue();
    expect(transport.accept(invalidEnvelope, "runtime.changed")).toBeFalse();
    expect(transport.accept(invalidEnvelope, "runtime.changed")).toBeFalse();
    await Promise.resolve();
    await Promise.resolve();

    expect(bootstrapCalls).toBe(1);
    expect(applied).toEqual([1, 2]);
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({ origin: "runtime.changed", stage: "base64", envelope: { dataLength: 4 } });
    expect(errors.at(-1)).toBeNull();
  });

  test("does not replace a valid snapshot when bootstrap becomes unavailable", async () => {
    const availability: boolean[] = [];
    const applied: number[] = [];
    const transport = createRuntimeSnapshotTransport({
      fetchBootstrap: async () => { throw new Error("offline"); },
      reportDecodeFailure: () => undefined,
      onSnapshot: (next) => applied.push(next.revision),
      onTransportError: () => undefined,
      onRuntimeUnavailable: (hasValidSnapshot) => availability.push(hasValidSnapshot),
    });
    transport.accept(encodeRuntimeSnapshot(snapshot(1)), "runtime.bootstrap");
    await transport.requestBootstrap("manual");
    expect(applied).toEqual([1]);
    expect(availability).toEqual([true]);
  });

  test("clears a transport error even when a valid resync has the same revision", () => {
    const errors: Array<string | null> = [];
    const transport = createRuntimeSnapshotTransport({
      fetchBootstrap: async () => encodeRuntimeSnapshot(snapshot(1)),
      reportDecodeFailure: () => undefined,
      onSnapshot: () => undefined,
      onTransportError: (message) => errors.push(message),
      onRuntimeUnavailable: () => undefined,
    });
    transport.accept(encodeRuntimeSnapshot(snapshot(1)), "runtime.bootstrap");
    transport.accept(invalidEnvelope, "runtime.bootstrap");
    transport.accept(encodeRuntimeSnapshot(snapshot(1)), "runtime.bootstrap");
    expect(errors.at(-1)).toBeNull();
  });
});
