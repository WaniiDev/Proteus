# Mastra runtime ownership

PROTEUS treats the installed Mastra APIs as the runtime source of truth:

- `AgentController` and `Session` own runs, threads, model switching, steering, follow-ups, approvals, and suspensions.
- `Session.thread.listMessages()` supplies canonical history; `toAISdkV5Messages()` converts it for rendering, including historical tool calls.
- `TaskSignalProvider` owns task state and supplies all four native task tools plus its task-state input processor. Proteus hooks only make repeated mutations idempotent; they do not maintain a parallel task machine.
- The native workspace `read_file` and `write_file` tools are remapped to `read_plan` and `write_plan`. Native `submit_plan` suspends on a relative Markdown path and resumes with Mastra's documented decision payload.
- `Session.followUp()` owns queued messages. The UI displays `displayState.queuedFollowUps` as a count and does not expose unsupported editing or restore operations.

## Task completion boundary

Mastra's `Agent.defaultOptions.prepareStep` is the run-loop boundary. The agent-level `afterToolCall` hook latches the real native `task_check` output by the controller thread id from `RequestContext`; after it reports `summary.allCompleted: true`, `prepareStep` returns `toolChoice: "none"` for the next step. This gives the model one final text-only response and prevents another task check. Three unchanged native task snapshots use the same bounded fallback, and repeated task calls return the latest successful native snapshot without mutating task state.

Live tool rows settle from `AgentController`'s `tool_end` event. For canonical history, successful input-only task calls are reconciled with Mastra's persisted `current-task-list` and `task-list-update` signals. Explicit live or persisted tool errors take precedence over inferred success.

Historical rendering suppresses only the two exact errors emitted by Proteus' retired task-loop guard when an identical successful tool call already exists in that user turn. It also collapses duplicate successful terminal checks with the same completed snapshot. Other native task errors remain visible, and stored Mastra messages are never rewritten.

Approval recovery is derived only from the current `Session.approval`, `displayState.pendingApproval`, and controller events. Persisted message metadata is historical context, not proof that an approval is currently pending.

## Compatibility boundary

`runtime.ts` projects Mastra state into the desktop IPC snapshot. This layer may sanitize tool payloads and shape display data, but it must not duplicate Mastra lifecycle ownership. The OpenRouter catalog endpoint remains provider-specific because the product displays modality and descriptive metadata outside Mastra's `AvailableModel` contract; selection still uses `Session.model.switch()`.

## Storage cutover

The v2 runtime uses `proteus-v2.db` and `proteus-plans-v2`. On first launch, an allowlisted, idempotent cutover removes only `proteus.db`, its WAL/SHM companions, and `proteus-session.json`, then writes `proteus-mastra-v2.cutover`. Windows Credential Manager data is not touched.

## Required gate

Every runtime phase must pass `bun test`, `bun run typecheck`, and the production build before commit. Run `graphify update .` after source changes.
