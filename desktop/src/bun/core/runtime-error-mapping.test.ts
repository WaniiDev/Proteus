import { describe, expect, test } from "bun:test";
import { extractSafeErrorMessage } from "./error-message";
import { workspaceRuntimeError } from "./runtime-error-mapping";

describe("runtime error mapping", () => {
  test("extracts Mastra error messages and redacts secrets", () => {
    expect(extractSafeErrorMessage({ details: { errorMessage: "workspace failed" } })).toBe("workspace failed");
    expect(extractSafeErrorMessage({ message: "Authorization: Bearer secret-token-value" })).toContain("[REDACTED]");
  });

  test("maps the owned app workspace failure to an actionable retry", () => {
    expect(workspaceRuntimeError(new Error("ENOENT: lstat 'C:\\profile\\proteus-workspace-v1'"))).toEqual({
      code: "workspace-unavailable",
      message: "Proteus could not open its local workspace. Check folder permissions, then restart Proteus.",
      retryable: true,
    });
  });

  test("maps an inaccessible owned app workspace to the same safe retry", () => {
    expect(workspaceRuntimeError(new Error("EPERM: mkdir 'C:\\profile\\proteus-workspace-v1'"))).toEqual({
      code: "workspace-unavailable",
      message: "Proteus could not open its local workspace. Check folder permissions, then restart Proteus.",
      retryable: true,
    });
  });

  test("keeps a disconnected project unavailable without suggesting recreation", () => {
    expect(workspaceRuntimeError(new Error("This chat's project folder is unavailable. Reconnect it from Projects before continuing."))).toEqual({
      code: "workspace-unavailable",
      message: "This chat's project folder is unavailable. Reconnect it from Projects before continuing.",
      retryable: false,
    });
  });
});
