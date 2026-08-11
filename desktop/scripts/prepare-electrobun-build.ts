import { existsSync, rmSync } from "node:fs";
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

export function prepareElectrobunBuild(): void {
  if (process.env.ELECTROBUN_BUILD_ENV !== "dev") return;

  const projectRoot = resolve(import.meta.dir, "..");
  if (process.platform === "win32" && process.env.ELECTROBUN_OS === "win") {
    const buildDirectory = process.env.ELECTROBUN_BUILD_DIR;
    if (!buildDirectory || !isProteusWindowsDevBuildDirectory(projectRoot, buildDirectory)) {
      throw new Error("Refusing to clean an unexpected Electrobun build directory.");
    }

    const cleanup = Bun.spawnSync({
      cmd: ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", windowsProcessCleanup],
      env: { ...process.env, PROTEUS_DEV_BUILD_DIR: buildDirectory },
      stdout: "inherit",
      stderr: "inherit",
    });
    if (cleanup.exitCode !== 0) throw new Error("Could not stop the stale Proteus dev process tree.");

    if (existsSync(buildDirectory)) rmSync(buildDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }

  const vite = Bun.spawnSync({
    cmd: [process.execPath, resolve(projectRoot, "node_modules", "vite", "bin", "vite.js"), "build"],
    cwd: projectRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (vite.exitCode !== 0) throw new Error("Vite could not rebuild the Proteus renderer.");
}

if (import.meta.main) prepareElectrobunBuild();
