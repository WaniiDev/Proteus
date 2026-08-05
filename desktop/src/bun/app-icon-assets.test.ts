import { describe, expect, it } from "bun:test";
import config from "../../electrobun.config";

describe("Proteus application icons", () => {
  it("configures native package icons for every desktop platform", () => {
    expect(config.build.win?.icon).toBe("assets/proteus.ico");
    expect(config.build.mac?.icons).toBe("assets/proteus.iconset");
    expect(config.build.linux?.icon).toBe("assets/proteus-orb.png");
  });

  it("ships the native and in-app icon assets", async () => {
    const files = [
      new URL("../../assets/proteus.ico", import.meta.url),
      new URL("../../assets/proteus-orb.png", import.meta.url),
      new URL("../mainview/assets/proteus-orb-32.png", import.meta.url),
      new URL("../mainview/assets/proteus-orb-64.png", import.meta.url),
      new URL("../mainview/assets/proteus-orb-256.png", import.meta.url),
    ];

    for (const file of files) {
      expect(await Bun.file(file).exists()).toBe(true);
    }
  });
});
