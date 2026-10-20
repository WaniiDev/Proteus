import type { ElectrobunConfig } from "electrobun";

// @mastra/code-sdk's Kimi provider reads its version from ../../package.json relative to the bundle at load time,
// which does not exist inside the packaged app. It checks the MASTRACODE_VERSION build constant first, so define it.
// Kept as a literal: Hutch serializes this config and it must not do file I/O. electrobun-config.test.ts keeps it
// equal to the installed @mastra/code-sdk version.
const codeSdkVersion = "1.14.0";

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
      define: { MASTRACODE_VERSION: JSON.stringify(codeSdkVersion) },
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
    watch: ["src/mainview", "src/shared"],
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
  scripts: {
    // Observed on Electrobun 1.18.1 (not re-verified on 2.x): watch rebuilds kill only the Windows launcher.
    // Clean up any surviving bundled child process before it removes the bundle.
    preBuild: "scripts/prepare-electrobun-build.ts",
  },
} satisfies ElectrobunConfig;
