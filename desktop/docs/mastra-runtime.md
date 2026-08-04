# Mastra runtime ownership

PROTEUS treats the installed Mastra APIs as the runtime source of truth:

- `AgentController` and `Session` own runs, threads, model switching, steering, follow-ups, approvals, and suspensions.
- `Session.thread.listMessages()` supplies canonical history; `toAISdkV5Messages()` converts it for rendering, including historical tool calls.
- `TaskSignalProvider` owns task state and supplies all four native task tools plus its task-state input processor. Proteus hooks enforce a monotonic boundary around each native task-list revision; they do not maintain or persist a parallel task machine.
- The native workspace `read_file` and `write_file` tools are remapped to `read_plan` and `write_plan`. Native `submit_plan` suspends on a relative Markdown path and resumes with Mastra's documented decision payload.
- `Session.followUp()` owns queued messages. The UI displays `displayState.queuedFollowUps` as a count and does not expose unsupported editing or restore operations.

## Task completion boundary

Mastra's documented tool hooks and `Agent.defaultOptions.prepareStep` are the run-loop boundary. `TaskSignalProvider` and its store remain the only task-state source of truth. Within one `task_write` revision, a completed task ID cannot be moved back to `pending` or `in_progress` with `task_update`; an intentional replan must replace the revision through the native `task_write` tool.

The agent-level `beforeToolCall` hook rejects duplicate, no-op, and completed-to-incomplete mutations before the native tool executes. It returns the latest successful native-shaped snapshot with `isError: false`, explains that state did not change, and identifies the next incomplete stable task ID. Mastra does not invoke `afterToolCall` for a short-circuited call, so correction attempts are counted in `beforeToolCall`: the first correction gives the model a chance to recover, while a second blocked mutation latches a text-only escape. `afterToolCall` records only real native results, retains the last successful snapshot across native errors, and uses a bounded six-snapshot history to detect an A-B-A recurrence without introducing durable state.

`prepareStep` resolves the exact controller thread from `RequestContext`. It returns `toolChoice: "none"` after a successful terminal `task_check`, after the second blocked mutation, or after a bounded recurrence. This gives the model one final normal response instead of another tool call. A successful `task_write` starts a new canonical revision, so deliberate replanning remains available through the framework.

Live tool rows settle from `AgentController`'s `tool_end` event. For canonical history, successful input-only task calls are reconciled with Mastra's persisted `current-task-list` and `task-list-update` signals. Explicit live or persisted tool errors take precedence over inferred success.

Historical rendering suppresses only the two exact errors emitted by Proteus' retired task-loop guard when an identical successful tool call already exists in that user turn. It also collapses duplicate successful terminal checks with the same completed snapshot. Current native calls and successful policy corrections remain visible once as truthful tool rows; the UI never hides or rewrites a real state regression. Other native task errors remain visible, and stored Mastra messages are never rewritten.

Approval recovery is derived only from the current `Session.approval`, `displayState.pendingApproval`, and controller events. Persisted message metadata is historical context, not proof that an approval is currently pending.

## Compatibility boundary

`runtime.ts` projects Mastra state into the desktop IPC snapshot. This layer may sanitize tool payloads and shape display data, but it must not duplicate Mastra lifecycle ownership. The OpenRouter catalog endpoint remains provider-specific because the product displays modality and descriptive metadata outside Mastra's `AvailableModel` contract; selection still uses `Session.model.switch()`.

## Storage cutover

The v2 runtime uses `proteus-v2.db` and `proteus-plans-v2`. On first launch, an allowlisted, idempotent cutover removes only `proteus.db`, its WAL/SHM companions, and `proteus-session.json`, then writes `proteus-mastra-v2.cutover`. Windows Credential Manager data is not touched.

## Required gate

Every runtime phase must pass `bun test`, `bun run typecheck`, and the production build before commit. Run `graphify update .` after source changes.
