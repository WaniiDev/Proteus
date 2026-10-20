import { describe, expect, test } from "bun:test";
import { decodeRuntimeSnapshot, encodeRuntimeSnapshot } from "../src/shared/runtime-snapshot-codec";
import { runtimeSnapshotSchema } from "../src/shared/contracts";
import { buildFixture, scenarios } from "./fixtures";

describe("preview fixtures", () => {
  for (const scenario of scenarios) {
    test(`${scenario} parses and survives the snapshot codec`, () => {
      const fixture = buildFixture(scenario);
      expect(runtimeSnapshotSchema.safeParse(fixture).success).toBe(true);
      expect(decodeRuntimeSnapshot(encodeRuntimeSnapshot(fixture))).toEqual(fixture);
    });
  }
});
