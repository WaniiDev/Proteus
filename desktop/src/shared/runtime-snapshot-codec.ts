import {
  runtimeSnapshotEnvelopeSchema,
  runtimeSnapshotSchema,
  type RuntimeSnapshot,
  type RuntimeSnapshotEnvelope,
} from "./contracts";

const BINARY_CHUNK_SIZE = 0x8000;

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
  const envelope = runtimeSnapshotEnvelopeSchema.parse(input);
  const json = new TextDecoder("utf-8", { fatal: true }).decode(base64ToBytes(envelope.data));
  return runtimeSnapshotSchema.parse(JSON.parse(json));
}
