import { describe, expect, it } from "bun:test";
import config from "../../electrobun.config";
import packageJson from "../../package.json";

describe("Proteus application icons", () => {
  it("configures native package icons for every desktop platform", () => {
    expect(config.build.win?.icon).toBe("assets/proteus.ico");
    expect(config.build.mac?.icons).toBe("assets/proteus.iconset");
    expect(config.build.linux?.icon).toBe("assets/proteus-orb.png");
    expect(config.build.copy?.["assets/proteus.ico"]).toBe("views/mainview/assets/proteus.ico");
    expect(config.build.copy?.["node_modules/@libsql/win32-x64-msvc"]).toBe(
      "bun/node_modules/@libsql/win32-x64-msvc",
    );
  });

  it("ships the native and in-app icon assets", async () => {
    const files = [
      new URL("../../assets/proteus.ico", import.meta.url),
      new URL("../../assets/proteus-orb.png", import.meta.url),
      new URL("../mainview/public/assets/proteus-orb-32.png", import.meta.url),
      new URL("../mainview/assets/proteus-orb-64.png", import.meta.url),
      new URL("../mainview/assets/proteus-orb-256.png", import.meta.url),
    ];

    for (const file of files) {
      expect(await Bun.file(file).exists()).toBe(true);
    }
  });

  it("lets Electrobun embed the Windows icon without project-side rcedit scripts", () => {
    expect(packageJson.scripts.build).toContain("electrobun build --env=stable");
    expect(Object.keys(packageJson.scripts).some((name) => name.startsWith("icon:"))).toBe(false);
  });

  it("uses the packaged ICO for the native Windows tray", async () => {
    const desktopEntrypoint = await Bun.file(new URL("./index.ts", import.meta.url)).text();
    expect(desktopEntrypoint).toContain('process.platform === "win32"');
    expect(desktopEntrypoint).toContain('views://mainview/assets/proteus.ico');
    expect(desktopEntrypoint).toContain('views://mainview/assets/proteus-orb-32.png');
  });
});
