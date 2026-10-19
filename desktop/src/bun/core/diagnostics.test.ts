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

  it("keeps token usage metadata while redacting exact secret keys", () => {
    const out = sanitizeDiagnosticValue({ tokenUsage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 }, token: "x", access_token: "y", "x-api-key": "z", refreshToken: "w" }) as Record<string, any>;
    expect(out.tokenUsage).toEqual({ inputTokens: 3, outputTokens: 4, totalTokens: 7 });
    expect([out.token, out.access_token, out["x-api-key"], out.refreshToken]).toEqual(["[REDACTED]", "[REDACTED]", "[REDACTED]", "[REDACTED]"]);
  });

  it("replaces free-text bodies with length summaries but keeps metadata", () => {
    const chunk = { type: "text-delta", runId: "r1", payload: { toolCallId: "t1", text: "private words", args: { path: "a.txt" }, result: "secret answer", status: "ok", size: 5 } };
    const out = sanitizeDiagnosticValue(chunk) as any;
    expect(out.type).toBe("text-delta");
    expect(out.payload.toolCallId).toBe("t1");
    expect(out.payload.text).toBe("[text: 13 chars]");
    expect(out.payload.args).toMatch(/^\[object: \d+ chars\]$/);
    expect(out.payload.result).toBe("[text: 13 chars]");
    expect(out.payload.status).toBe("ok");
    expect(JSON.stringify(out)).not.toContain("private words");
  });

  it("redacts camelCase singular token keys but keeps token counters", () => {
    const out = sanitizeDiagnosticValue({ authToken: "a", apiToken: "b", oauthToken: "c", bearerToken: "d", inputTokens: 1, outputTokens: 2, totalTokens: 3, maxTokens: 4, tokenUsage: 5 }) as Record<string, unknown>;
    expect([out.authToken, out.apiToken, out.oauthToken, out.bearerToken]).toEqual(["[REDACTED]", "[REDACTED]", "[REDACTED]", "[REDACTED]"]);
    expect([out.inputTokens, out.outputTokens, out.totalTokens, out.maxTokens, out.tokenUsage]).toEqual([1, 2, 3, 4, 5]);
  });

  it("summarizes tool-call-suspended plan and question bodies", () => {
    const chunk = { type: "tool-call-suspended", payload: { toolCallId: "t1", suspendPayload: { plan: "private plan", question: "private question?" }, plan: "private plan", question: "private question?", feedback: "private feedback" } };
    const out = sanitizeDiagnosticValue(chunk) as any;
    expect(out.payload.toolCallId).toBe("t1");
    expect(out.payload.suspendPayload).toMatch(/^\[object: \d+ chars\]$/);
    expect(out.payload.plan).toBe("[text: 12 chars]");
    expect(out.payload.question).toBe("[text: 17 chars]");
    expect(out.payload.feedback).toBe("[text: 16 chars]");
    expect(JSON.stringify(out)).not.toContain("private");
  });
});
