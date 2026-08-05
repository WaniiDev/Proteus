import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "PROTEUS",
    identifier: "com.proteus.companion",
    version: "0.0.1",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
      // MastraCode's settings module contains an optional Stagehand dynamic import.
      // PROTEUS does not enable that browser subsystem, so keep it out of the
      // desktop runtime bundle instead of pulling Playwright into production.
      external: ["@mastra/stagehand", "playwright-core", "playwright-core/*"],
    },
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
      "node_modules/@napi-rs/keyring-win32-x64-msvc/keyring.win32-x64-msvc.node": "bun/keyring.win32-x64-msvc.node",
    },
    watchIgnore: ["dist/**"],
    win: {
      bundleCEF: false,
    },
    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
