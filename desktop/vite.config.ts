import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defineConfig, type AliasOptions } from "vite";
import react from "@vitejs/plugin-react";

// Electrobun 2 ships its SDK in the Hutch devkit (.hutch/devkit), not node_modules: the npm `electrobun`
// package only exports a module that throws. Vite has its own resolver, so it needs the devkit's aliases
// (`electrobun prepare`, run by `bun run dev`, projects the devkit before this config loads).
const devkit = resolve(dirname(fileURLToPath(import.meta.url)), ".hutch/devkit");
const helper = ["ts", "js", "mjs"].map((ext) => resolve(devkit, `api/config/electrobun-vite.${ext}`)).find(existsSync);
let electrobunAliases: AliasOptions = [];
if (helper) {
  const { electrobunViteAliases } = (await import(pathToFileURL(helper).href)) as { electrobunViteAliases: (devkit: string) => AliasOptions };
  electrobunAliases = electrobunViteAliases(devkit);
} else {
  console.warn("[proteus] .hutch/devkit is missing, so `electrobun/*` imports won't resolve. Run `bunx electrobun prepare` first.");
}

export default defineConfig({
  plugins: [react()],
  root: "src/mainview",
  resolve: { alias: electrobunAliases },
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
