import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Proteus",
    identifier: "com.proteus.companion",
    version: "0.0.1",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
      // MastraCode's settings module contains an optional Stagehand dynamic import.
      // Proteus does not enable that browser subsystem, so keep it out of the
      // desktop runtime bundle instead of pulling Playwright into production.
      external: ["@mastra/stagehand", "playwright-core", "playwright-core/*"],
    },
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
      "src/mainview/assets/proteus-orb-32.png": "views/mainview/assets/proteus-orb-32.png",
      "node_modules/@napi-rs/keyring-win32-x64-msvc/keyring.win32-x64-msvc.node": "bun/keyring.win32-x64-msvc.node",
    },
    watchIgnore: ["dist/**"],
    win: {
      bundleCEF: false,
      icon: "assets/proteus.ico",
    },
    mac: {
      bundleCEF: false,
      icons: "assets/proteus.iconset",
    },
    linux: {
      bundleCEF: false,
      icon: "assets/proteus-orb.png",
    },
  },
} satisfies ElectrobunConfig;
