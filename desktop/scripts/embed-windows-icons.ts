import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

if (process.platform !== "win32") {
  console.info("Skipping Windows executable icon embedding on this platform.");
  process.exit(0);
}

const projectRoot = resolve(import.meta.dir, "..");
const iconPath = resolve(projectRoot, "assets", "proteus.ico");
const rceditPath = resolve(projectRoot, "node_modules", "rcedit", "bin", "rcedit-x64.exe");
const prepareOnly = process.argv.includes("--prepare");
const buildOnly = process.argv.includes("--build");

if (!existsSync(iconPath)) throw new Error(`Proteus icon is missing: ${iconPath}`);
if (!existsSync(rceditPath)) throw new Error(`rcedit is missing: ${rceditPath}`);

const targets: string[] = [];

if (!buildOnly) {
  // Electrobun 1.18.1's compiled Windows CLI resolves rcedit from its CI build
  // path. Pre-embed the icon into the runtime templates that the CLI copies so
  // dev and production bundles remain correctly branded when that lookup fails.
  const templateDirectory = resolve(projectRoot, "node_modules", "electrobun", "dist-win-x64");
  targets.push(resolve(templateDirectory, "launcher.exe"), resolve(templateDirectory, "bun.exe"));
}

if (!prepareOnly) {
  const executables = new Bun.Glob("build/**/*.exe");

  for await (const relativePath of executables.scan({ cwd: projectRoot, onlyFiles: true })) {
    const name = basename(relativePath).toLowerCase();
    const isRuntime = name === "launcher.exe" || name === "bun.exe";
    const isProteusPackage = name.startsWith("proteus") && (name.includes("setup") || name.includes("installer"));
    if (isRuntime || isProteusPackage) targets.push(resolve(projectRoot, relativePath));
  }
}

const uniqueTargets = [...new Set(targets)];
if (uniqueTargets.length === 0) throw new Error("No Proteus Windows executables were found for icon embedding.");

for (const target of uniqueTargets) {
  if (!existsSync(target)) throw new Error(`Windows executable is missing: ${target}`);
  const result = Bun.spawnSync({
    cmd: [rceditPath, target, "--set-icon", iconPath],
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to embed the Proteus icon into ${target}.`);
  }
  console.info(`Embedded Proteus icon: ${target}`);
}
