import type { ChatToolPart, OrbState, RuntimeSnapshot } from "../shared/contracts";

const ACTIVE_TOOL_STATUSES = new Set<ChatToolPart["status"]>(["streaming_input", "running"]);

export function activeOrbToolNames(snapshot: RuntimeSnapshot): Set<string> {
  return new Set(
    snapshot.messages
      .flatMap((message) => message.parts)
      .filter((part): part is ChatToolPart => part.type === "tool" && ACTIVE_TOOL_STATUSES.has(part.status))
      .map((part) => part.name),
  );
}

export function deriveOrbSteadyState(snapshot: RuntimeSnapshot): OrbState {
  if (snapshot.error && snapshot.error.code !== "aborted") return "error";
  if (snapshot.workbench.status === "waiting") return "waiting";
  const activeRun = snapshot.activeRun?.threadId === snapshot.activeThreadId && snapshot.activeRun.status === "running" ? snapshot.activeRun : null;
  if (!activeRun) return "idle";
  if (activeOrbToolNames(snapshot).has("write_plan")) return "drafting";
  return snapshot.messages.some((message) => message.status === "streaming") ? "working" : "thinking";
}

export function recoveryGate(previousHadError: boolean, threadChanged: boolean, steadyState: OrbState): OrbState[] | null {
  if (!previousHadError || threadChanged || steadyState === "error") return null;
  return ["recovery", "idle", steadyState];
}
