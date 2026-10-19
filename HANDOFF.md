# Proteus handoff

_Updated 2026-10-19 after syncing `main` to `73fc90c`._

## Objective

Maintain and extend Proteus, an Electrobun desktop personal AI companion. The desktop app should keep Mastra as the source of truth for agent runs, queues, history, memory, tasks, suspensions, and storage while exposing a safe, responsive React interface.

## Current status

`main` is at `73fc90c` (`Merge WAN-501 refactor (#3)`), on Mastra 1.78 (`@mastra/core` 1.78.0) and Electrobun 2.0.4. Follow-up work on top of it: a flaky `runtime-thread-isolation` test fix, thread-load error handling (a failed thread metadata read keeps the previous selection and surfaces an error instead of defaulting to the app workspace; `initialize` continues to the provider and credential steps), small nits, and the docs refresh (root [README.md](README.md), this file, [desktop/docs/mastra-runtime.md](desktop/docs/mastra-runtime.md)).

## Verified state

- The Bun backend entrypoint and RPC boundary are in [desktop/src/bun/index.ts](desktop/src/bun/index.ts).
- `TextRuntime` in [desktop/src/bun/runtime.ts](desktop/src/bun/runtime.ts) is a ~340-line facade. Behaviour lives in the services under [desktop/src/bun/runtime/](desktop/src/bun/runtime): `context` (shared snapshot and run state), `thread-service`, `provider-service`, `workspace-service`, `memory-service`, `interaction-service`, `continuation-service`, `run-coordinator`, `message-projector`/`message-mapping`, `agent-factory`. State used by one service is private to it; the module layout section of the runtime doc lists it.
- Other backend code is grouped by feature: `core/`, `native/`, `providers/`, `workspace/`, `memory/`, `tools/`. Shared contracts are in `desktop/src/shared`.
- The React surface is in [desktop/src/mainview](desktop/src/mainview) (`components/`, `hooks/`, `views/`, `lib/`, `orb/`).
- Mastra ownership, workspace containment, approval/suspension semantics, providers, storage, packaging, and backlog are documented in [desktop/docs/mastra-runtime.md](desktop/docs/mastra-runtime.md).

## Remaining work

1. Run the focused desktop tests and typecheck from `desktop/` before making or shipping further changes:
   `bun test` and `bun run typecheck` (on a fresh checkout run `bun run build` once first so the gitignored `desktop/.hutch` Electrobun typings exist).
2. If changing runtime behavior, update [desktop/docs/mastra-runtime.md](desktop/docs/mastra-runtime.md).
3. Treat the documented backlog as intentionally deferred: evaluate search, skills, AST editing, and LSP before enabling them; design durable restart-safe session-level tool trust; keep observability backends out of scope unless that decision changes.
4. For a release-level check, run `bun run build` and `bun run test:e2e` after focused tests pass.

## Key decisions and constraints

- Mastra owns the canonical run lifecycle; do not introduce a second renderer-side run state machine.
- Workspace roots are server-owned and contained. The private app workspace may be created by Proteus; missing attached project folders must remain unavailable rather than being silently recreated or redirected.
- Workspace rebinding is allowed only for a truly empty, idle conversation; after the first message the binding is immutable.
- Filesystem and command tools are deny-by-default. Writes, edits, directory mutation, command execution, and process termination require approval.
- Credentials remain in Windows Credential Manager and must not enter IPC snapshots, messages, diagnostics, thread metadata, or plan files.
- Docker is not required for this project.

## Risks and gotchas

- `runtime-thread-isolation.test.ts` had a 5s hook timeout that flaked roughly 1 in 3 full runs; the follow-up flaky fix addresses it. Re-run it if it fails.
- Run `bun run build` and `bun run test:e2e` before a release; they are not part of the quick baseline.
- On Windows, `LocalSandbox` uses host execution (`isolation: "none"`); approval UI and agent instructions must continue to state that limitation.
- Preserve unrelated user changes if they appear later, especially generated/runtime data or lockfile changes.

## Verification / definition of done

From `desktop/`, a healthy baseline is:

```powershell
bun test
bun run typecheck
```

For release confidence, also run:

```powershell
bun run test:e2e
bun run build
```

A future feature is complete only when its focused tests and typecheck pass, its Mastra/workspace security boundaries remain intact, and relevant documentation is updated.
