import { appendFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DiagnosticEntry, DiagnosticSource, DiagnosticsSnapshot } from "../shared/contracts";

const MAX_ENTRIES = 2_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(?:api.?key|authorization|bearer|cookie|credential|password|refresh.?token|secret|token)/i;

export type DiagnosticInput = {
  source: DiagnosticSource;
  type: string;
  phase?: string;
  threadId?: string | null;
  runId?: string | null;
  toolCallId?: string | null;
  durationMs?: number;
  payload?: unknown;
};

function redactString(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\bsk-(?:or-v1-)?[A-Za-z0-9_-]{12,}\b/g, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/([?&](?:code|token|access_token|refresh_token|api_key)=)[^&\s]+/gi, `$1${REDACTED}`)
    .slice(0, 8_000);
}

export function sanitizeDiagnosticValue(value: unknown, key = "", depth = 0, seen = new WeakSet<object>()): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (typeof value === "symbol") return String(value);
  if (depth >= 7) return "[truncated]";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      ...(value.stack ? { stack: redactString(value.stack) } : {}),
      ...(value.cause !== undefined ? { cause: sanitizeDiagnosticValue(value.cause, "cause", depth + 1, seen) } : {}),
    };
  }
  if (typeof value !== "object") return redactString(String(value));
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => sanitizeDiagnosticValue(item, "", depth + 1, seen));
  if (value instanceof Map) return sanitizeDiagnosticValue(Object.fromEntries([...value.entries()].slice(0, 100)), key, depth + 1, seen);
  if (value instanceof Set) return sanitizeDiagnosticValue([...value].slice(0, 80), key, depth + 1, seen);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 100)
      .map(([entryKey, entryValue]) => [entryKey, sanitizeDiagnosticValue(entryValue, entryKey, depth + 1, seen)]),
  );
}

export class RuntimeDiagnostics {
  private readonly entries: DiagnosticEntry[] = [];
  private readonly filePath: string;
  private enabled = true;
  private sequence = 0;
  private pendingLines: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, "proteus-diagnostics.jsonl");
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const content = await readFile(this.filePath, "utf8");
      for (const line of content.trim().split(/\r?\n/).slice(-MAX_ENTRIES)) {
        if (!line) continue;
        try {
          const entry = JSON.parse(line) as DiagnosticEntry;
          if (typeof entry.sequence !== "number" || typeof entry.timestamp !== "string" || typeof entry.type !== "string") continue;
          this.entries.push(entry);
          this.sequence = Math.max(this.sequence, entry.sequence);
        } catch {
          // A partial final line must not prevent diagnostics from opening.
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("Unable to load runtime diagnostics", error);
    }
    this.record({ source: "runtime", type: "diagnostics_initialized", payload: { retainedEntries: this.entries.length } });
  }

  record(input: DiagnosticInput): DiagnosticEntry | null {
    if (!this.enabled) return null;
    const entry: DiagnosticEntry = {
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      source: input.source,
      type: input.type.slice(0, 160),
      ...(input.phase ? { phase: input.phase.slice(0, 120) } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
      ...(input.durationMs === undefined ? {} : { durationMs: Math.max(0, Math.round(input.durationMs * 10) / 10) }),
      ...(input.payload === undefined ? {} : { payload: sanitizeDiagnosticValue(input.payload) }),
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    this.pendingLines.push(JSON.stringify(entry));
    this.scheduleFlush();
    return entry;
  }

  snapshot(limit = 500): DiagnosticsSnapshot {
    const safeLimit = Math.max(1, Math.min(MAX_ENTRIES, Math.floor(limit)));
    return {
      enabled: this.enabled,
      filePath: this.filePath,
      entries: structuredClone(this.entries.slice(-safeLimit)),
    };
  }

  setEnabled(enabled: boolean): DiagnosticsSnapshot {
    this.enabled = enabled;
    if (enabled) this.record({ source: "runtime", type: "diagnostics_enabled" });
    return this.snapshot();
  }

  async clear(): Promise<DiagnosticsSnapshot> {
    await this.flush();
    this.entries.length = 0;
    await writeFile(this.filePath, "", "utf8");
    return this.snapshot();
  }

  async export(): Promise<string> {
    await this.flush();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const exportPath = join(dirname(this.filePath), `proteus-diagnostics-${stamp}.json`);
    await writeFile(exportPath, `${JSON.stringify(this.snapshot(MAX_ENTRIES), null, 2)}\n`, "utf8");
    return exportPath;
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const lines = this.pendingLines.splice(0);
    if (lines.length === 0) return this.flushPromise;
    this.flushPromise = this.flushPromise.then(async () => {
      await this.rotateIfNeeded();
      await appendFile(this.filePath, `${lines.join("\n")}\n`, "utf8");
    }).catch((error) => console.warn("Unable to persist runtime diagnostics", error));
    return this.flushPromise;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 120);
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      if ((await stat(this.filePath)).size < MAX_FILE_BYTES) return;
      const previousPath = `${this.filePath}.previous`;
      await unlink(previousPath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
      await rename(this.filePath, previousPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
