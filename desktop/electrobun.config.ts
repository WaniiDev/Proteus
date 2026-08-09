import type { ElectrobunConfig } from "electrobun";

const windowsIcon = process.env.PROTEUS_WINDOWS_ICONS_PREPARED === "1" ? undefined : "assets/proteus.ico";

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
      "assets/proteus.ico": "views/mainview/assets/proteus.ico",
      "node_modules/@napi-rs/keyring-win32-x64-msvc/keyring.win32-x64-msvc.node": "bun/keyring.win32-x64-msvc.node",
      "node_modules/@libsql/win32-x64-msvc": "bun/node_modules/@libsql/win32-x64-msvc",
      // onnxruntime-node is bundled into bun/index.js, but its native loader
      // keeps this path relative to that bundle: ../bin/napi-v6/win32/x64.
      // Ship the complete directory because the binding also loads its sibling
      // ONNX Runtime and DirectML DLLs at runtime.
      "node_modules/onnxruntime-node/bin/napi-v6/win32/x64": "bin/napi-v6/win32/x64",
    },
    watchIgnore: ["dist/**"],
    win: {
      bundleCEF: false,
      // Electrobun 1.18.1's packaged CLI cannot resolve its bundled rcedit.
      // The project scripts pre-embed this icon into the Windows templates and
      // disable only the CLI's duplicate pass for prepared invocations.
      icon: windowsIcon,
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
