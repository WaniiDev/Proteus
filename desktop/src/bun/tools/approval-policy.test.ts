import { describe, expect, it } from "bun:test";
import { approvalFingerprint, stableApprovalValue } from "./approval-policy";

describe("approval policy", () => {
  it("canonicalizes object key order", () => {
    expect(stableApprovalValue({ b: 2, a: { d: 4, c: 3 } })).toBe(stableApprovalValue({ a: { c: 3, d: 4 }, b: 2 }));
  });

  it("binds the fingerprint to tool name and exact arguments", () => {
    const shown = approvalFingerprint("write_file", { path: "a.txt", content: "one" });
    expect(shown).toBe(approvalFingerprint("write_file", { content: "one", path: "a.txt" }));
    expect(shown).not.toBe(approvalFingerprint("write_file", { path: "a.txt", content: "two" }));
    expect(shown).not.toBe(approvalFingerprint("delete_file", { path: "a.txt", content: "one" }));
  });
});
