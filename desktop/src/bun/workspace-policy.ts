import { WORKSPACE_TOOLS, type WorkspaceToolsConfig } from "@mastra/core/workspace";

/** Explicit allowlist: Mastra upgrades cannot silently expose new workspace tools. */
export const FILE_WORKSPACE_TOOLS: WorkspaceToolsConfig = {
  enabled: false,
  [WORKSPACE_TOOLS.FILESYSTEM.READ_FILE]: { enabled: true },
  [WORKSPACE_TOOLS.FILESYSTEM.LIST_FILES]: { enabled: true },
  [WORKSPACE_TOOLS.FILESYSTEM.FILE_STAT]: { enabled: true },
  [WORKSPACE_TOOLS.FILESYSTEM.GREP]: { enabled: true },
  [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: { enabled: true, requireApproval: true, requireReadBeforeWrite: true },
  [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: { enabled: true, requireApproval: true, requireReadBeforeWrite: true },
  [WORKSPACE_TOOLS.FILESYSTEM.MKDIR]: { enabled: true, requireApproval: true },
  [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: { enabled: true, requireApproval: true },
};
