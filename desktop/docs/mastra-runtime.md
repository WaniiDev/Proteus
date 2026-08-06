# Mastra runtime ownership

Proteus uses the installed Mastra `Agent` as its run, queue, suspension, history, memory, task, and storage backbone. The desktop runtime is an adapter: it projects framework state into an Electrobun IPC snapshot and never maintains a second run lifecycle.

- `Agent.queueMessage()` and `Agent.subscribeToThread()` own queued and active turns.
- `Agent.listSuspendedRuns()` is the canonical recovery source for both `requireApproval` calls and tools paused with `suspend()`.
- `Agent.sendToolApproval()` resolves `requireApproval` calls. `Agent.sendStreamResume()` resolves `ask_user` and `submit_plan` suspensions.
- Every response includes the exact `toolCallId`; Proteus never relies on Mastra's most-recent-call fallback.
- Persistent LibSQL storage supplies canonical message history and suspended run snapshots. `toAISdkV5Messages()` converts stored history for rendering.
- `TaskSignalProvider` owns task state and supplies the native task tools and task-state input processor.
- `Workspace` supplies contained filesystem tools. The native `read_file` and `write_file` capabilities are exposed privately as `read_plan` and `write_plan`.

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

The runtime uses `proteus-v2.db` and `proteus-plans-v2`. A one-time allowlisted cutover removes only legacy v1 database/session files. Credential Manager data is untouched.

The Electrobun bundle includes the MastraCode OAuth gateway runtime. Optional Stagehand and Playwright subsystems are external because Proteus does not enable them. Docker is not required.

## Backlog

- Expand the contained Workspace tool catalog only after reviewing each native tool's approval policy.
- Add durable session-level trust when Mastra provides a restart-safe native grant path or a deliberately scoped persistence design is approved.
- Keep observability backends out of scope; local diagnostics remain sufficient for this application.

## Required gate

Each implementation phase must pass its focused tests and typecheck before commit. The final phase runs `bun test`, `bun run typecheck`, the production build, and `graphify update .`.
