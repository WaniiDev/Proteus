import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { resolveCodexAcpLaunch } from "./codex-acp";

describe("Codex ACP packaging", () => {
  it("resolves the official adapter and matching Codex executable", () => {
    const launch = resolveCodexAcpLaunch();

    expect(launch.command).toBe(process.execPath);
    expect(launch.args).toHaveLength(1);
    expect(existsSync(launch.args[0]!)).toBe(true);
    expect(existsSync(launch.env.CODEX_PATH!)).toBe(true);
    expect(launch.env.INITIAL_AGENT_MODE).toBe("read-only");
  });
});
