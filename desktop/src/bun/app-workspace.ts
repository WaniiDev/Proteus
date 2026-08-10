import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export const PROTEUS_APP_WORKSPACE_DIRECTORY = "proteus-workspace-v1";

export function proteusAppWorkspaceRoot(userDataRoot: string): string {
  return join(userDataRoot, PROTEUS_APP_WORKSPACE_DIRECTORY);
}

/** Provision only the app-owned workspace before registry canonicalization. */
export async function ensureProteusAppWorkspace(userDataRoot: string): Promise<string> {
  const root = proteusAppWorkspaceRoot(userDataRoot);
  await mkdir(root, { recursive: true });
  return root;
}
