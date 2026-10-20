import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export function isProteusWindowsDevBuildDirectory(projectRoot: string, candidate: string): boolean {
  const relativePath = relative(resolve(projectRoot), resolve(candidate));
  if (!relativePath || isAbsolute(relativePath) || relativePath.startsWith("..")) return false;
  const segments = relativePath.split(/[\\/]+/);
  return segments.length === 2 && segments[0] === "build" && /^dev-win-(?:x64|arm64)$/.test(segments[1] ?? "");
}

const windowsProcessCleanup = String.raw`
$ErrorActionPreference = "Stop"
$target = [IO.Path]::GetFullPath($env:PROTEUS_DEV_BUILD_DIR).TrimEnd('\') + '\'

function Get-ProteusDevProcesses {
  @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($target, [StringComparison]::OrdinalIgnoreCase)
  })
}

$locked = Get-ProteusDevProcesses
$lockedIds = @($locked | ForEach-Object { $_.ProcessId })
$roots = @($locked | Where-Object { $lockedIds -notcontains $_.ParentProcessId })
$ErrorActionPreference = "Continue"
foreach ($process in $roots) {
  & taskkill.exe /PID ([string]$process.ProcessId) /T /F 2>$null | Out-Null
}
$ErrorActionPreference = "Stop"

$deadline = [DateTime]::UtcNow.AddSeconds(5)
do {
  $remaining = Get-ProteusDevProcesses
  if ($remaining.Count -eq 0) { break }
  Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)

if ($remaining.Count -gt 0) {
  Write-Error "Proteus dev processes did not exit before the rebuild."
  exit 1
}

if ($locked.Count -gt 0) {
  Write-Output "Stopped $($locked.Count) stale Proteus dev process(es) before rebuild."
}
`;

// Electrobun 2 runs build hooks through Hutch on its own runtime (Cottontail), where Bun-only APIs
// (import.meta.main, import.meta.dir, Bun.spawnSync, a Bun process.execPath) are not guaranteed.
// Use Node APIs, find the project from the working directory, and spawn `bun` from PATH.
export function findProjectRoot(cwd: string): string {
  for (const candidate of [cwd, resolve(cwd, "desktop")]) {
    try {
      if (JSON.parse(readFileSync(resolve(candidate, "package.json"), "utf8")).name === "proteus-desktop") return candidate;
    } catch {}
  }
  throw new Error(`Could not find the Proteus desktop project from ${cwd}.`);
}

function run(cmd: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): number {
  const result = spawnSync(cmd, args, { ...options, stdio: "inherit", shell: process.platform === "win32" && cmd === "bun" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export function prepareElectrobunBuild(): void {
  if (process.env.ELECTROBUN_BUILD_ENV !== "dev") return;

  const projectRoot = findProjectRoot(process.cwd());
  if (process.platform === "win32" && process.env.ELECTROBUN_OS === "win") {
    const buildDirectory = process.env.ELECTROBUN_BUILD_DIR;
    if (!buildDirectory || !isProteusWindowsDevBuildDirectory(projectRoot, buildDirectory)) {
      throw new Error("Refusing to clean an unexpected Electrobun build directory.");
    }

    const cleanup = run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", windowsProcessCleanup], {
      env: { ...process.env, PROTEUS_DEV_BUILD_DIR: buildDirectory },
    });
    if (cleanup !== 0) throw new Error("Could not stop the stale Proteus dev process tree.");

    if (existsSync(buildDirectory)) rmSync(buildDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }

  console.log("[proteus] Rebuilding the renderer (vite build)…");
  const vite = run("bun", [resolve(projectRoot, "node_modules", "vite", "bin", "vite.js"), "build"], { cwd: projectRoot });
  if (vite !== 0) throw new Error("Vite could not rebuild the Proteus renderer.");
}

// Hutch runs this file directly with ELECTROBUN_BUILD_ENV set; tests import it without that variable.
if (process.env.ELECTROBUN_BUILD_ENV) prepareElectrobunBuild();
