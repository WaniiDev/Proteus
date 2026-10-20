import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config.ts";

// Browser preview of the real renderer: `electrobun/view` is replaced by a mock.
export default mergeConfig(base, defineConfig({
  resolve: { alias: { "electrobun/view": fileURLToPath(new URL("./preview/electrobun-view.ts", import.meta.url)) } },
  server: { port: 5181, strictPort: false, fs: { allow: [fileURLToPath(new URL(".", import.meta.url))] } },
}));
