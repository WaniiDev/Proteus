import { describe, expect, it } from "bun:test";
import config from "./electrobun.config";
import codeSdk from "./node_modules/@mastra/code-sdk/package.json";

describe("electrobun build config", () => {
  it("defines MASTRACODE_VERSION so the bundled code-sdk never reads a package.json at startup", () => {
    expect(config.build.bun.define?.MASTRACODE_VERSION).toBe(JSON.stringify(codeSdk.version));
  });
});
