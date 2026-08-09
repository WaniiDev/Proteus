import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import config from "../../electrobun.config";

const onnxSource = "node_modules/onnxruntime-node/bin/napi-v6/win32/x64";
const onnxDestination = "bin/napi-v6/win32/x64";

describe("packaged native runtime assets", () => {
  it("preserves onnxruntime-node's bundle-relative Windows layout", () => {
    expect(config.build.copy?.[onnxSource]).toBe(onnxDestination);

    const bundledDirectory = join("Resources", "app", "bun");
    const resolvedBinding = join(bundledDirectory, "..", onnxDestination, "onnxruntime_binding.node");
    expect(resolvedBinding).toBe(
      join("Resources", "app", "bin", "napi-v6", "win32", "x64", "onnxruntime_binding.node"),
    );
  });

  it("includes the ONNX binding and its sibling runtime DLLs", async () => {
    for (const filename of [
      "onnxruntime_binding.node",
      "onnxruntime.dll",
      "DirectML.dll",
      "dxcompiler.dll",
      "dxil.dll",
    ]) {
      const asset = Bun.file(new URL(`../../${onnxSource}/${filename}`, import.meta.url));
      expect(await asset.exists()).toBe(true);
    }
  });
});
