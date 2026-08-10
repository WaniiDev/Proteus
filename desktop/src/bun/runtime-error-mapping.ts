import type { RuntimeError } from "../shared/contracts";
import { extractSafeErrorMessage } from "./error-message";

export function workspaceRuntimeError(error: unknown): RuntimeError | null {
  const message = extractSafeErrorMessage(error, "");
  if (/project folder is unavailable|selected project folder is unavailable/i.test(message)) {
    return {
      code: "workspace-unavailable",
      message: "This chat's project folder is unavailable. Reconnect it from Projects before continuing.",
      retryable: false,
    };
  }
  if (
    /(?:ENOENT|EACCES|EPERM).*(?:proteus-workspace-v1|workspace)|(?:proteus-workspace-v1|workspace).*(?:ENOENT|EACCES|EPERM)/i.test(
      message,
    )
  ) {
    return {
      code: "workspace-unavailable",
      message: "Proteus could not open its local workspace. Check folder permissions, then restart Proteus.",
      retryable: true,
    };
  }
  return null;
}
