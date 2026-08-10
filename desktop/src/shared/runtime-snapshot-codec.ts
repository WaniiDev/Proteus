import {
  runtimeSnapshotEnvelopeSchema,
  runtimeSnapshotSchema,
  type RuntimeSnapshot,
  type RuntimeSnapshotEnvelope,
} from "./contracts";

const BINARY_CHUNK_SIZE = 0x8000;

export type RuntimeSnapshotDecodeStage = "envelope" | "base64" | "utf8" | "json" | "snapshot";
export type RuntimeSnapshotDecodeDiagnostic = {
  stage: RuntimeSnapshotDecodeStage;
  envelope: {
    version?: string | number;
    encoding?: string;
    dataLength?: number;
  };
  issues?: Array<{ path: string; code: string; message: string }>;
};

export class RuntimeSnapshotDecodeError extends Error {
  constructor(readonly diagnostic: RuntimeSnapshotDecodeDiagnostic, options?: ErrorOptions) {
    super(`Runtime snapshot decoding failed during ${diagnostic.stage}.`, options);
    this.name = "RuntimeSnapshotDecodeError";
  }
}

function envelopeMetadata(input: unknown): RuntimeSnapshotDecodeDiagnostic["envelope"] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const record = input as { version?: unknown; encoding?: unknown; data?: unknown };
  return {
    ...(typeof record.version === "string" || typeof record.version === "number" ? { version: record.version } : {}),
    ...(typeof record.encoding === "string" ? { encoding: record.encoding.slice(0, 64) } : {}),
    ...(typeof record.data === "string" ? { dataLength: record.data.length } : {}),
  };
}

function diagnosticIssues(error: unknown): RuntimeSnapshotDecodeDiagnostic["issues"] {
  if (!error || typeof error !== "object" || !Array.isArray((error as { issues?: unknown }).issues)) return undefined;
  return (error as { issues: Array<{ path?: unknown; code?: unknown; message?: unknown }> }).issues.slice(0, 20).map((issue) => ({
    path: Array.isArray(issue.path) ? issue.path.map(String).join(".").slice(0, 200) : "",
    code: typeof issue.code === "string" ? issue.code.slice(0, 80) : "invalid",
    message: typeof issue.message === "string" ? issue.message.slice(0, 300) : "Validation failed",
  }));
}

function decodeFailure(stage: RuntimeSnapshotDecodeStage, input: unknown, cause: unknown): RuntimeSnapshotDecodeError {
  const issues = diagnosticIssues(cause);
  return new RuntimeSnapshotDecodeError({
    stage,
    envelope: envelopeMetadata(input),
    ...(issues?.length ? { issues } : {}),
  }, { cause });
}

export function describeRuntimeSnapshotDecodeFailure(error: unknown, input: unknown): RuntimeSnapshotDecodeDiagnostic {
  if (error instanceof RuntimeSnapshotDecodeError) return error.diagnostic;
  return { stage: "envelope", envelope: envelopeMetadata(input) };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BINARY_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BINARY_CHUNK_SIZE));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function encodeRuntimeSnapshot(snapshot: RuntimeSnapshot): RuntimeSnapshotEnvelope {
  const json = JSON.stringify(snapshot);
  return {
    version: 1,
    encoding: "utf8-base64-json",
    data: bytesToBase64(new TextEncoder().encode(json)),
  };
}

export function decodeRuntimeSnapshot(input: unknown): RuntimeSnapshot {
  let envelope: RuntimeSnapshotEnvelope;
  try {
    envelope = runtimeSnapshotEnvelopeSchema.parse(input);
  } catch (error) {
    const issues = diagnosticIssues(error);
    const invalidBase64 = issues?.some((issue) => issue.path === "data" && /base64/i.test(issue.message));
    throw decodeFailure(invalidBase64 ? "base64" : "envelope", input, error);
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(envelope.data);
  } catch (error) {
    throw decodeFailure("base64", envelope, error);
  }
  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw decodeFailure("utf8", envelope, error);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw decodeFailure("json", envelope, error);
  }
  try {
    return runtimeSnapshotSchema.parse(parsed);
  } catch (error) {
    throw decodeFailure("snapshot", envelope, error);
  }
}
