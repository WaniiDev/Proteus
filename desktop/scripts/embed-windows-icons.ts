import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

if (process.platform !== "win32") {
  console.info("Skipping Windows executable icon embedding on this platform.");
  process.exit(0);
}

const projectRoot = resolve(import.meta.dir, "..");
const iconPath = resolve(projectRoot, "assets", "proteus.ico");
const rceditPath = resolve(projectRoot, "node_modules", "rcedit", "bin", "rcedit-x64.exe");

if (!existsSync(iconPath)) throw new Error(`Proteus icon is missing: ${iconPath}`);
if (!existsSync(rceditPath)) throw new Error(`rcedit is missing: ${rceditPath}`);

const targets: string[] = [];
const executables = new Bun.Glob("build/**/*.exe");

for await (const relativePath of executables.scan({ cwd: projectRoot, onlyFiles: true })) {
  const name = basename(relativePath).toLowerCase();
  const isRuntime = name === "launcher.exe" || name === "bun.exe";
  const isProteusPackage = name.startsWith("proteus") && (name.includes("setup") || name.includes("installer"));
  if (isRuntime || isProteusPackage) targets.push(resolve(projectRoot, relativePath));
}

if (targets.length === 0) throw new Error("No Proteus Windows executables were found under desktop/build.");

for (const target of targets) {
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
