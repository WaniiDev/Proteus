# Mastra runtime ownership

Proteus uses the installed Mastra `Agent` as its run, queue, suspension, history, memory, task, and storage backbone. The desktop runtime is an adapter: it projects framework state into an Electrobun IPC snapshot and never maintains a second run lifecycle.

- `Agent.queueMessage()` and `Agent.subscribeToThread()` own queued and active turns.
- `Agent.listSuspendedRuns()` is the canonical recovery source for both `requireApproval` calls and tools paused with `suspend()`.
- `Agent.sendToolApproval()` resolves `requireApproval` calls. `Agent.sendStreamResume()` resolves `ask_user` and `submit_plan` suspensions.
- Every response includes the exact `toolCallId`; Proteus never relies on Mastra's most-recent-call fallback.
- Persistent LibSQL storage supplies canonical message history and suspended run snapshots. `toAISdkV5Messages()` converts stored history for rendering.
- `TaskSignalProvider` owns task state and supplies the native task tools and task-state input processor.
- A resolver-backed `Workspace` supplies native filesystem and command tools. Proteus builds a server-owned `RequestContext` for every idle wake; the renderer never supplies a filesystem root.
- Plan drafts remain in a separate contained `Workspace`. Its native read/write capabilities are exposed privately as `read_plan` and `write_plan`.

## Workspace boundary

Proteus follows the official Mastra Workspace overview end to end rather than
wrapping it in a parallel tool system:

- **Workspace creation:** both the agent workspace and private plan workspace
  are native `Workspace` instances registered with the application `Mastra`.
- **Filesystem:** a contained `LocalFilesystem` is resolved from trusted
  `RequestContext` state for each chat. Native read/list/stat/grep operations
  are available, while mutations use Mastra's read-before-write and approval
  controls.
- **Sandbox:** a resolver-backed `LocalSandbox` is started lazily, cached per
  conversation, and destroyed with the workspace. Command execution and
  process termination require native tool approval.
- **Dynamic configuration:** filesystem, sandbox, cache keys, and sandbox
  instructions are all request-context resolvers. This keeps one registered
  workspace while preserving a different immutable root per conversation.
- **Agent integration:** `workspace` is supplied directly to `Agent`, and
  `createWorkspaceTools` provides the official Mastra tool implementations.
  Proteus only applies an explicit capability policy and a compatibility
  schema normalization; it does not reimplement their execution.
- **Lifecycle:** resolver-owned filesystems and sandboxes are explicitly
  destroyed, the sandbox cache is cleared, and `Workspace.destroy()` runs as
  part of runtime shutdown.

Each conversation has an immutable workspace binding: either the private Proteus app workspace or one attached project folder. Existing conversations migrate to the app workspace. Project records live in a Mastra `FactoryStorageDomain`; conversation metadata stores only the binding. If an attached folder is moved, deleted, or forgotten, the chat becomes explicitly unavailable until the user reconnects it. Proteus never silently redirects it to the app workspace.

`RequestContext` carries the trusted thread ID, workspace kind, and canonical root from the Bun runtime into `Agent.queueMessage()` through `ifIdle.streamOptions`. A dynamic `LocalFilesystem` is constructed with `contained: true`, so traversal and symlink escapes outside that root are rejected by Mastra.

The filesystem tool allowlist is deny-by-default:

- Read, list, stat, and grep run automatically.
- Write and edit require approval and Mastra's `requireReadBeforeWrite` protection.
- Directory creation and deletion require approval.
- AST editing, indexed search, LSP, browser, and skills are not enabled.

Commands use a resolver-backed `LocalSandbox`, keyed by conversation ID for background-process continuity. Execute and kill require approval; reading process output does not. Resolver-created filesystem and sandbox providers are owned and destroyed by Proteus. On Windows, `LocalSandbox` uses `isolation: "none"`: commands run on the host from the selected working directory, so the approval card and agent instructions state that limitation explicitly.

The Mastra `AgentController` beta API is deliberately not part of this runtime. Its controller session state and grants are process-local in Mastra 1.56, while Proteus requires approvals to survive refreshes and restarts.

## Approval and suspension boundary

Mastra has two distinct human-in-the-loop paths and Proteus preserves that distinction:

1. A tool configured with `requireApproval: true` emits `tool-call-approval`. Proteus shows the emitted tool name and exact arguments, then calls `sendToolApproval()` with the stored `toolCallId`.
2. A tool calling `suspend()` emits `tool-call-suspended`. `ask_user` resumes with schema-valid answer data; `submit_plan` resumes with `{ action: "approved" | "rejected", feedback? }`.

Before applying any decision, Proteus re-runs `listSuspendedRuns()` for the conversation and requires an exact thread, run, and tool-call match. Generic approvals also carry a stable SHA-256 fingerprint of the canonical tool name and arguments shown to the user. If the current stored request differs, the old approval is rejected. The renderer receives only this projected pending-action state; historical message metadata is never treated as proof that an action remains pending.

The response RPC waits until Mastra accepts `sendToolApproval()` or `sendStreamResume()`. It does not wait for the resumed model turn or tool execution to finish. This is the framework's acknowledgement boundary and prevents both false “failed” results after a successful response and premature UI completion.

Pending actions use one UI model for approvals, questions, and plan review. Multiple tool calls remain distinct by `runId` plus `toolCallId`; resolving one cannot overwrite another. A refresh or process restart reconstructs them from Mastra storage.

Session-scoped “trust this tool” grants remain backlog work. They must not be added until they can be made durable without reintroducing an independent approval lifecycle.

## Plan boundary

`write_plan` is a private contained-workspace operation and does not require a second approval. `submit_plan` is the sole plan checkpoint and uses Mastra's native suspension/resume contract. Approval resumes with the approved implementation-tool allowlist; rejection leaves plan authoring available for revision.

Plan Markdown is hydrated from the contained plan filesystem. Repeated suspension projections preserve the existing interaction state and version. A plan tool row is not marked complete until Mastra accepts the resume and the canonical stream/history settles it.

## Task boundary

`TaskSignalProvider` and its store remain the only durable task-state source. Proteus may reject duplicate/no-op mutations at the agent hook boundary and project native task signals onto historical tool rows, but it does not persist a parallel task machine or rewrite stored Mastra messages.

Historical rendering removes only artifacts emitted by the retired task-loop guard when an identical successful call already exists in the same turn. Genuine native task errors remain visible.

## Providers

OpenRouter and Codex are alternative primary model providers. The chosen provider, model, and reasoning effort are persisted with the conversation; there is no silent fallback to OpenRouter.

Codex uses MastraCode's `MastraCodeGateway` with `routeThroughMastraGateway: false`. MastraCode owns ChatGPT OAuth and model construction. Credentials remain in Windows Credential Manager and never enter IPC snapshots, messages, diagnostics, thread metadata, or plan files.

## Storage and packaging

The runtime uses `proteus-v3.db`, `proteus-plans-v2`, and the app-owned `proteus-workspace-v1` directory. A one-time allowlisted cutover removes only legacy v1 database/session files. Credential Manager data is untouched.

The Electrobun bundle includes the MastraCode OAuth gateway runtime. Optional Stagehand and Playwright subsystems are external because Proteus does not enable them. Docker is not required.

## Backlog

- Evaluate search, skills, AST editing, and LSP separately before expanding the explicit Workspace allowlist.
- Add durable session-level trust when Mastra provides a restart-safe native grant path or a deliberately scoped persistence design is approved.
- Keep observability backends out of scope; local diagnostics remain sufficient for this application.

## Required gate

Each implementation phase must pass its focused tests and typecheck before commit. The final phase runs `bun test`, `bun run typecheck`, the production build, and `graphify update .`.
