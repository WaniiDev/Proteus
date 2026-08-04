import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const CUTOVER_MARKER = "proteus-mastra-v2.cutover";
const LEGACY_RUNTIME_FILES = ["proteus.db", "proteus.db-shm", "proteus.db-wal", "proteus-session.json"] as const;

/**
 * Perform the approved one-time reset of pre-v2 runtime state.
 * Credential Manager data and every path outside this explicit allowlist are untouched.
 */
export async function cutOverLegacyRuntimeData(userDataPath: string): Promise<void> {
  const basePath = resolve(userDataPath);
  const markerPath = join(basePath, CUTOVER_MARKER);
  await mkdir(basePath, { recursive: true });

  try {
    await access(markerPath);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await Promise.all(LEGACY_RUNTIME_FILES.map((fileName) => rm(join(basePath, fileName), { force: true })));
  await writeFile(markerPath, "Mastra v2 runtime cutover complete.\n", { encoding: "utf8", flag: "wx" });
}
