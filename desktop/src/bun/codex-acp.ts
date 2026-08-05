import { existsSync } from "node:fs";
import { join } from "node:path";

const ADAPTER_FILE = "codex-acp.js";
const CODEX_EXECUTABLE = process.platform === "win32" ? "codex.exe" : "codex";

export type CodexAcpLaunch = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

function firstExisting(candidates: string[]): string | undefined {
  return candidates.find((candidate) => existsSync(candidate));
}

export function resolveCodexAcpLaunch(): CodexAcpLaunch {
  const adapter = firstExisting([
    join(import.meta.dir, ADAPTER_FILE),
    join(process.cwd(), "node_modules", "@agentclientprotocol", "codex-acp", "dist", "index.js"),
  ]);
  const codex = firstExisting([
    join(import.meta.dir, "codex", "bin", CODEX_EXECUTABLE),
    join(
      process.cwd(),
      "node_modules",
      "@openai",
      `codex-${process.platform}-${process.arch}`,
      "vendor",
      process.platform === "win32" && process.arch === "x64" ? "x86_64-pc-windows-msvc" : "",
      "bin",
      CODEX_EXECUTABLE,
    ),
  ]);

  if (!adapter) throw new Error("The bundled Codex ACP adapter is unavailable");
  if (!codex) throw new Error("The bundled Codex executable is unavailable");

  return {
    command: process.execPath,
    args: [adapter],
    env: {
      CODEX_PATH: codex,
      INITIAL_AGENT_MODE: "read-only",
    },
  };
}
