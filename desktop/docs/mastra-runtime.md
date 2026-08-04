# Mastra runtime ownership

PROTEUS treats the installed Mastra APIs as the runtime source of truth:

- `AgentController` and `Session` own runs, threads, model switching, steering, follow-ups, approvals, and suspensions.
- `Session.thread.listMessages()` supplies canonical history; `toAISdkV5Messages()` converts it for rendering, including historical tool calls.
- `TaskSignalProvider` owns task state. Proteus hooks only reject exact repeated/no-progress mutations; they do not maintain a parallel task machine.
- The native workspace `read_file` and `write_file` tools are remapped to `read_plan` and `write_plan`. Native `submit_plan` suspends on a relative Markdown path and resumes with Mastra's documented decision payload.
- `Session.followUp()` owns queued messages. The UI displays `displayState.queuedFollowUps` as a count and does not expose unsupported editing or restore operations.

## Compatibility boundary

`runtime.ts` projects Mastra state into the desktop IPC snapshot. This layer may sanitize tool payloads and shape display data, but it must not duplicate Mastra lifecycle ownership. The OpenRouter catalog endpoint remains provider-specific because the product displays modality and descriptive metadata outside Mastra's `AvailableModel` contract; selection still uses `Session.model.switch()`.

## Storage cutover

The v2 runtime uses `proteus-v2.db` and `proteus-plans-v2`. On first launch, an allowlisted, idempotent cutover removes only `proteus.db`, its WAL/SHM companions, and `proteus-session.json`, then writes `proteus-mastra-v2.cutover`. Windows Credential Manager data is not touched.

## Required gate

Every runtime phase must pass `bun test`, `bun run typecheck`, and the production build before commit. Run `graphify update .` after source changes.

