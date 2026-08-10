import type { RuntimeSnapshot, RuntimeSnapshotDecodeReport, RuntimeSnapshotEnvelope } from "../shared/contracts";
import { decodeRuntimeSnapshot, describeRuntimeSnapshotDecodeFailure } from "../shared/runtime-snapshot-codec";

export type RuntimeSnapshotOrigin = RuntimeSnapshotDecodeReport["origin"];
export type BootstrapReason = "initial" | "automatic" | "manual";

type RuntimeSnapshotTransportDependencies = {
  fetchBootstrap: () => Promise<RuntimeSnapshotEnvelope>;
  reportDecodeFailure: (report: RuntimeSnapshotDecodeReport) => void;
  onSnapshot: (snapshot: RuntimeSnapshot) => void;
  onTransportError: (message: string | null) => void;
  onRuntimeUnavailable: (hasValidSnapshot: boolean) => void;
};

export type RuntimeSnapshotTransport = {
  accept: (envelope: RuntimeSnapshotEnvelope, origin: RuntimeSnapshotOrigin) => boolean;
  requestBootstrap: (reason: BootstrapReason) => Promise<void>;
  dispose: () => void;
};

export function createRuntimeSnapshotTransport(dependencies: RuntimeSnapshotTransportDependencies): RuntimeSnapshotTransport {
  // Revision zero is a valid first snapshot, so the sentinel must sort before
  // every revision the runtime can publish.
  let latestRevision = -1;
  let hasValidSnapshot = false;
  let automaticRecoveryAttempted = false;
  let bootstrapInFlight: Promise<void> | null = null;
  let disposed = false;

  const accept = (envelope: RuntimeSnapshotEnvelope, origin: RuntimeSnapshotOrigin): boolean => {
    try {
      const next = decodeRuntimeSnapshot(envelope);
      if (disposed) return false;
      hasValidSnapshot = true;
      automaticRecoveryAttempted = false;
      dependencies.onTransportError(null);
      if (next.revision <= latestRevision) return true;
      latestRevision = next.revision;
      dependencies.onSnapshot(next);
      return true;
    } catch (error) {
      if (disposed) return false;
      dependencies.reportDecodeFailure({ origin, ...describeRuntimeSnapshotDecodeFailure(error, envelope) });
      dependencies.onTransportError("A runtime update could not be decoded. Proteus is reconnecting to the desktop runtime.");
      if (origin === "runtime.changed") void requestBootstrap("automatic");
      return false;
    }
  };

  const requestBootstrap = (reason: BootstrapReason): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (bootstrapInFlight) return bootstrapInFlight;
    if (reason === "automatic") {
      if (automaticRecoveryAttempted) return Promise.resolve();
      automaticRecoveryAttempted = true;
    } else if (reason === "manual") {
      automaticRecoveryAttempted = false;
    }
    bootstrapInFlight = dependencies.fetchBootstrap()
      .then((envelope) => {
        accept(envelope, "runtime.bootstrap");
      })
      .catch(() => {
        if (!disposed) dependencies.onRuntimeUnavailable(hasValidSnapshot);
      })
      .finally(() => {
        bootstrapInFlight = null;
      });
    return bootstrapInFlight;
  };

  return {
    accept,
    requestBootstrap,
    dispose: () => {
      disposed = true;
    },
  };
}
