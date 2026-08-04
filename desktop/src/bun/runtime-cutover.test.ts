import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cutOverLegacyRuntimeData } from "./runtime-cutover";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Mastra v2 runtime cutover", () => {
  it("deletes only allowlisted legacy runtime files and is idempotent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proteus-cutover-"));
    temporaryDirectories.push(directory);
    const legacyFiles = ["proteus.db", "proteus.db-shm", "proteus.db-wal", "proteus-session.json"];
    await Promise.all(legacyFiles.map((fileName) => writeFile(join(directory, fileName), "legacy")));
    await writeFile(join(directory, "credentials-preserved.test"), "keep");

    await cutOverLegacyRuntimeData(directory);
    await cutOverLegacyRuntimeData(directory);

    for (const fileName of legacyFiles) expect(await Bun.file(join(directory, fileName)).exists()).toBe(false);
    expect(await readFile(join(directory, "credentials-preserved.test"), "utf8")).toBe("keep");
    expect(await readFile(join(directory, "proteus-mastra-v2.cutover"), "utf8")).toContain("complete");
  });
});

