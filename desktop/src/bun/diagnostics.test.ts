import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeDiagnostics, sanitizeDiagnosticValue } from "./diagnostics";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("runtime diagnostics", () => {
  it("redacts credentials, bearer tokens, OAuth query values, and circular references", () => {
    const circular: Record<string, unknown> = { authorization: "Bearer top-secret", apiKey: "sk-or-v1-secretvalue1234", callback: "http://localhost/?code=oauth-secret" };
    circular.self = circular;

    const sanitized = sanitizeDiagnosticValue(circular) as Record<string, unknown>;
    expect(sanitized.authorization).toBe("[REDACTED]");
    expect(sanitized.apiKey).toBe("[REDACTED]");
    expect(sanitized.callback).toBe("http://localhost/?code=[REDACTED]");
    expect(sanitized.self).toBe("[circular]");
  });

  it("persists a bounded, exportable JSONL event stream without secrets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proteus-diagnostics-"));
    temporaryDirectories.push(directory);
    const diagnostics = new RuntimeDiagnostics(directory);
    await diagnostics.initialize();
    diagnostics.record({ source: "mastra", type: "tool_end", toolCallId: "tool-1", payload: { result: "ok", token: "do-not-save" } });

    const exportedPath = await diagnostics.export();
    const exported = await readFile(exportedPath, "utf8");
    expect(exported).toContain("tool_end");
    expect(exported).toContain("[REDACTED]");
    expect(exported).not.toContain("do-not-save");

    diagnostics.setEnabled(false);
    const count = diagnostics.snapshot().entries.length;
    diagnostics.record({ source: "runtime", type: "ignored" });
    expect(diagnostics.snapshot().entries).toHaveLength(count);
    await diagnostics.flush();
  });
});
