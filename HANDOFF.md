# Handoff: default app workspace prevents every chat run

_From Codex investigation to the next developer or agent · 2026-08-10 · repository `WaniiDev/Proteus` · branch `main`_

## Objective

Fix the post-workspace-expansion regression where a normal message such as `Hello!` stops without an assistant response and the UI reports: `A runtime update could not be decoded. Restart Proteus and try again.` Done means a fresh Proteus profile can send a normal chat from the default app workspace, the real desktop response completes, and the misleading decode banner does not appear.

## Current status

**Root run failure confirmed; no fix applied.** The app launches and the ONNX native runtime loads, but every agent turn bound to the default app workspace fails before model execution because `proteus-workspace-v1` does not exist. The renderer then shows a generic decoder failure that masks the actionable backend error.

The user explicitly limited this investigation to editing this handoff file. No source, test, generated Graphify, database, or runtime-data file was changed.

## Confirmed evidence

- The supplied screenshot was created at `2026-08-10 01:07:09 +07:00`. It shows the optimistic `Hello!` user message followed by the decode banner and no assistant response.
- The live diagnostic file `C:\Users\UsEr\AppData\Local\com.proteus.companion\dev\proteus-diagnostics.jsonl` recorded the matching run error at `2026-08-09T18:06:35.873Z` (`2026-08-10 01:06:35.873 +07:00`):
  - thread: `d6281a4f-6e9c-484b-a5b3-5b2774fd678b`
  - run: `4f785651-9f85-4e7d-868b-3c14fa311bf5`
  - error: `ENOENT: no such file or directory, lstat 'C:\Users\UsEr\AppData\Local\com.proteus.companion\dev\proteus-workspace-v1'`
- The same `ENOENT` occurred on two earlier real runs at `2026-08-09T18:04:33.480Z` and `2026-08-09T18:04:50.526Z`, so this is repeatable rather than a one-off transport glitch.
- A read-only filesystem check confirmed that `C:\Users\UsEr\AppData\Local\com.proteus.companion\dev` exists while its `proteus-workspace-v1` child does not.
- The regression entered through workspace expansion commit `ed8b4b1` and merge commit `b458acc`.

## Root cause

1. `desktop/src/bun/runtime.ts:424` defines the default app root as `join(Utils.paths.userData, "proteus-workspace-v1")`.
2. `TextRuntime.initialize()` at `desktop/src/bun/runtime.ts:1371` ensures only the parent user-data directory. It never creates `this.appWorkspaceRoot`.
3. `requestContextFor()` at `desktop/src/bun/runtime.ts:1154` puts the nonexistent app root into `proteus-workspace-root` for every app-bound chat.
4. Agent tool assembly resolves that path through `WorkspaceRegistry.resolveFromContext()`.
5. `WorkspaceRegistry.canonicalRoot()` at `desktop/src/bun/workspace-registry.ts:77` calls `realpath(root)` before `get()` can initialize a workspace. `realpath()` therefore throws `ENOENT` before the model call starts.

This is not database corruption, a provider outage, or the previously fixed ONNX packaging problem.

## Why the UI message is misleading

- `desktop/src/mainview/App.tsx:1162` catches every failure from `decodeRuntimeSnapshot()` and replaces it with the generic decode banner. The catch discards the exception and records neither Zod issues nor safe envelope metadata.
- `decodeRuntimeSnapshot()` at `desktop/src/shared/runtime-snapshot-codec.ts:36` can fail at envelope validation, Base64 decoding, JSON parsing, or runtime-snapshot validation. The rejected runtime envelope is not persisted, so the exact failing layer cannot be recovered after the fact.
- The focused codec tests pass, which shows valid in-process envelopes round-trip; they do not exercise the real Electrobun message bridge for this terminal-error snapshot.
- Separately, the Mastra `error` chunk is written to diagnostics, but the terminal-error projection does not reliably surface its original message as the user-facing `RuntimeSnapshot.error`. This observability gap helps the generic banner hide the actionable `ENOENT`.

Treat the missing workspace directory as the confirmed run blocker. Treat the exact decoder subfailure as **still unproven** until the rejected envelope or sanitized decoder issues are captured during a real reproduction.

## Existing test gap

The current workspace tests all create their root before registry resolution:

- `desktop/src/bun/workspace-registry.test.ts` creates `project/src` in its fixture.
- `desktop/src/bun/workspace-agent.integration.test.ts` uses `mkdtemp()` as the workspace root.
- `desktop/e2e/workspace.pw.ts` creates its fixture root before constructing the registry and does not launch the real desktop chat flow.

Read-only verification during this investigation:

```text
bun test src/bun/workspace-registry.test.ts src/bun/workspace-agent.integration.test.ts src/shared/runtime-snapshot-codec.test.ts
10 passed, 0 failed, 31 assertions
```

These green tests are consistent with the bug because none begins with a missing default app root.

## Immediate next actions

1. Create the default app workspace during runtime initialization, before any thread subscription or agent tool assembly. The narrow candidate is an idempotent `mkdir(this.appWorkspaceRoot, { recursive: true })` immediately after `ensureUserDataDirectory()` in `TextRuntime.initialize()`.
2. Do **not** make `WorkspaceRegistry` silently create every missing root. Missing project-bound roots must remain unavailable so Proteus does not recreate deleted or disconnected project folders unexpectedly.
3. Add a regression test that starts with a present user-data directory and an absent `proteus-workspace-v1`, initializes the relevant runtime/workspace path, and proves the default root exists before registry resolution.
4. Add a real integration assertion for the default app binding, not only a registry fixture whose root is pre-created.
5. Preserve and surface the original Mastra terminal error. A workspace setup failure should produce an actionable runtime error instead of disappearing behind a transport message.
6. Instrument the renderer decoder catch with sanitized diagnostics: failure stage/Zod issues, envelope version/encoding, and data length. Never log snapshot content, credentials, or full Base64 data.
7. Reproduce through the actual Electrobun desktop bridge with a cold profile: delete nothing from the user's real profile; use an isolated test user-data root. Send `Hello!` and confirm a complete assistant response.

## Key decisions and rationale

- Prefer explicit creation of Proteus's owned app workspace over generic registry auto-creation. Proteus owns that directory; it does not own arbitrary project roots.
- Preserve `realpath()` canonicalization after the owned root exists. It is part of the containment/symlink boundary and should not be weakened.
- Do not treat manually creating the missing directory as the final fix. It may unblock one profile but leaves cold installs and clean profiles broken.
- Do not delete or reset `proteus-v3.db`, WebView2 data, credentials, or diagnostics. The evidence points to missing initialization, not corrupt persisted state.
- Keep the decode investigation separate from the confirmed workspace failure. Fixing the root directory should restore chat, but the transport/observability gap still needs a regression test rather than an assumption.

## Risks and gotchas

- `mkdir()` must run before the Agent asks `WorkspaceRegistry` for tools; creating it only when the Workspace pane opens is too late.
- Project bindings must still fail with the existing reconnect guidance when their real folders are missing.
- The renderer currently swallows the decoder exception. A failed retest without added diagnostics will again provide only the generic banner.
- Restart the desktop Bun process for manual retests; rebuilding only the Vite view cannot load backend changes.
- `desktop/bun.lock` is already modified locally by the user's Bun 1.4 install (`configVersion: 0`). It is unrelated to this handoff, is intentionally unstaged, and must not be reverted or included in the handoff commit.
- The global shortcut warning `Win32 error: 1409` is unrelated; it means another process already owns the shortcut and does not cause this chat failure.

## Repository state at handoff

- Branch: `main`
- Starting commit: `30c4850` (`fix(desktop): package ONNX Windows runtime assets`)
- Intended commit scope: `HANDOFF.md` only
- Existing unrelated local change: `desktop/bun.lock` (unstaged; preserve it)
- No source fix has been attempted.
- Graphify was queried read-only. `graphify update .` was deliberately not run because this turn may edit only the handoff.

## How to verify / definition of done

Use an isolated cold app-data root where `proteus-workspace-v1` is absent, then verify:

1. Runtime initialization creates the owned default workspace idempotently.
2. `WorkspaceRegistry.resolveFromContext()` succeeds for an app-bound thread.
3. A real desktop `Hello!` turn reaches the model and renders a complete assistant response.
4. Diagnostics contain no `lstat ... proteus-workspace-v1` error.
5. A deliberately missing project-bound workspace remains unavailable and is not recreated.
6. A deliberately invalid runtime envelope records a sanitized reason and recovers without hiding unrelated backend errors.
7. `bun test`, `bun run typecheck`, the real workspace E2E, and the packaged Electrobun dev run all pass.

The task is complete only when the cold-profile real-chat path passes end to end, not merely when the missing directory is created manually or unit tests stay green.
