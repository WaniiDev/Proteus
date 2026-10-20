import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { findProjectRoot, isProteusWindowsDevBuildDirectory } from "./prepare-electrobun-build";

describe("Electrobun Windows watch cleanup", () => {
  const projectRoot = resolve(import.meta.dir, "..");

  test("allows only Proteus Windows dev bundle directories", () => {
    expect(isProteusWindowsDevBuildDirectory(projectRoot, resolve(projectRoot, "build", "dev-win-x64"))).toBeTrue();
    expect(isProteusWindowsDevBuildDirectory(projectRoot, resolve(projectRoot, "build", "dev-win-arm64"))).toBeTrue();
  });

  test("rejects production, broad, and out-of-project deletion targets", () => {
    expect(isProteusWindowsDevBuildDirectory(projectRoot, resolve(projectRoot, "build"))).toBeFalse();
    expect(isProteusWindowsDevBuildDirectory(projectRoot, resolve(projectRoot, "build", "stable-win-x64"))).toBeFalse();
    expect(isProteusWindowsDevBuildDirectory(projectRoot, resolve(projectRoot, ".."))).toBeFalse();
  });

  test("watches renderer sources and rebuilds Vite through the dev hook", async () => {
    const config = await Bun.file(resolve(projectRoot, "electrobun.config.ts")).text();
    const hook = await Bun.file(resolve(projectRoot, "scripts", "prepare-electrobun-build.ts")).text();
    expect(config).toContain('watch: ["src/mainview", "src/shared"]');
    expect(config).toContain('watchIgnore: ["dist/**"]');
    expect(hook).toContain('"vite", "bin", "vite.js"');
  });

  test("runs under Hutch's runtime: no Bun-only APIs, triggered by the hook environment", async () => {
    const hook = await Bun.file(resolve(projectRoot, "scripts", "prepare-electrobun-build.ts")).text();
    const code = hook.replace(/\/\/.*$/gm, "");
    for (const bunOnly of ["import.meta.main", "import.meta.dir", "Bun.spawnSync", "process.execPath"]) expect(code).not.toContain(bunOnly);
    expect(code).toContain("if (process.env.ELECTROBUN_BUILD_ENV) prepareElectrobunBuild();");
    // Hutch owns the build output; the hook must never remove it.
    expect(code).not.toMatch(/\brmSync\b|\brm\(/);
  });

  test("finds the desktop project from the desktop folder or the repo root", () => {
    expect(findProjectRoot(projectRoot)).toBe(projectRoot);
    expect(findProjectRoot(resolve(projectRoot, ".."))).toBe(projectRoot);
  });

  test("the dev and start scripts build the renderer before Electrobun copies dist", async () => {
    const pkg = await Bun.file(resolve(projectRoot, "package.json")).json();
    for (const script of ["dev", "start"]) expect(pkg.scripts[script]).toContain("electrobun prepare && vite build && ");
  });

  test("Vite resolves electrobun/* through the Hutch devkit aliases, never node_modules", async () => {
    const vite = await Bun.file(resolve(projectRoot, "vite.config.ts")).text();
    expect(vite).toContain("electrobunViteAliases(devkit)");
    expect(vite).toContain("resolve: { alias: electrobunAliases }");
  });
});
