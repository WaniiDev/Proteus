import { useEffect, useRef, useState } from "react";
import type { OrbState, RuntimeSnapshot } from "../../shared/contracts";
import { deriveOrbSteadyState, recoveryGate } from "../orb/orb-state";

export function useConversationOrbState(snapshot: RuntimeSnapshot): {
  state: OrbState;
  pulseVersion: number;
} {
  const [state, setState] = useState<OrbState>("idle");
  const [pulseVersion, setPulseVersion] = useState(0);
  const previousRef = useRef<{
    threadId: string | null;
    runId: string | null;
    runStatus: string | null;
    hadError: boolean;
  } | null>(null);
  const transientRef = useRef(false);
  const recoveryTargetRef = useRef<OrbState | null>(null);
  const timersRef = useRef<number[]>([]);
  useEffect(() => {
    const previous = previousRef.current;
    const threadChanged = previous !== null && previous.threadId !== snapshot.activeThreadId;
    const activeRun = snapshot.activeRun?.threadId === snapshot.activeThreadId ? snapshot.activeRun : null;
    const steadyState = deriveOrbSteadyState(snapshot);
    const clearTimers = () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current = [];
      transientRef.current = false;
      recoveryTargetRef.current = null;
    };
    const sequence = (steps: Array<{ state: OrbState; duration: number }>) => {
      clearTimers();
      transientRef.current = true;
      let elapsed = 0;
      setState(steps[0].state);
      steps.slice(1).forEach((step, index) => {
        elapsed += steps[index].duration;
        timersRef.current.push(
          window.setTimeout(() => {
            setState(step.state);
            if (index === steps.length - 2) {
              transientRef.current = false;
              timersRef.current = [];
            }
          }, elapsed),
        );
      });
    };
    const startErrorRecovery = (target: OrbState) => {
      clearTimers();
      transientRef.current = true;
      recoveryTargetRef.current = target;
      setState("recovery");
      timersRef.current = [
        window.setTimeout(() => setState("idle"), 1300),
        window.setTimeout(() => {
          setState(recoveryTargetRef.current ?? "idle");
          recoveryTargetRef.current = null;
          transientRef.current = false;
          timersRef.current = [];
        }, 1500),
      ];
    };
    if (threadChanged) clearTimers();
    const recovered = recoveryGate(previous?.hadError ?? false, threadChanged, steadyState);
    if (steadyState === "error") {
      clearTimers();
      setState("error");
    } else if (recoveryTargetRef.current) {
      recoveryTargetRef.current = steadyState;
    } else if (recovered) {
      startErrorRecovery(recovered[2]);
    } else if (steadyState === "waiting") {
      clearTimers();
      setState("waiting");
    } else if (activeRun?.status === "running") {
      clearTimers();
      setState(steadyState);
    } else if (!threadChanged && previous?.runStatus === "running" && previous.runId) {
      if (snapshot.error?.code === "aborted" || activeRun?.status === "aborted")
        sequence([
          { state: "interrupted", duration: 1400 },
          { state: "recovery", duration: 1300 },
          { state: "idle", duration: 0 },
        ]);
      else if (!snapshot.error) {
        setPulseVersion((value) => value + 1);
        sequence([
          { state: "done", duration: 1400 },
          { state: "idle", duration: 0 },
        ]);
      }
    } else if (!transientRef.current) setState(steadyState);
    previousRef.current = {
      threadId: snapshot.activeThreadId,
      runId: activeRun?.runId ?? null,
      runStatus: activeRun?.status ?? null,
      hadError: steadyState === "error",
    };
  }, [snapshot]);
  useEffect(() => () => timersRef.current.forEach((timer) => window.clearTimeout(timer)), []);
  return { state, pulseVersion };
}
