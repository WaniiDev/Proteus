# Proteus project handoff

_Prepared on 2026-08-06 for a future developer or agent. Repository: `WaniiDev/Proteus`; branch: `main`._

## Objective

Fix Proteus workspace command tool calls when a model emits numeric JSON fields as strings, and ensure tool failures never appear as completed in live or restored chat history. Done means this real-chat call executes after approval and its timeline reflects the truthful outcome:

```json
{"command":"git status","cwd":".","tail":"100","timeout":"30"}
```

## Current status

**Unresolved in the running app.** A narrow compatibility implementation is present and all automated tests pass, but the user retested and still receives the same validation error. Do not claim this is fixed until a real desktop-chat reproduction succeeds.

The known failure is Mastra rejecting `tail: "100"` with `expected number, received string`. The command does not execute. `timeout: "30"` is accepted by the installed Mastra schema because that field already uses preprocessing; `tail` does not.

## Implemented and verified

- `desktop/src/bun/workspace-tool-compat.ts` wraps Mastra's native `createWorkspaceTools()` result and extends only the native `mastra_workspace_execute_command` input schema so finite numeric strings supplied to `tail` become numbers. It does not replace command execution, approval, or sandbox behavior.
- `desktop/src/bun/runtime.ts` explicitly adds the compatible agent-workspace tools before the separate private plan-workspace tools.
- `desktop/src/bun/tool-result-error.ts` recognizes both Mastra `{ isError: true }` output and structured `{ error: true }` validation output.
- `desktop/src/bun/native-stream-projection.ts` now marks structured tool-result failures as `error` and retains their message instead of showing `completed`.
- Persisted message projection in `desktop/src/bun/runtime.ts` uses the same structured-error classifier.
- Added focused tests in:
  - `desktop/src/bun/workspace-tool-compat.test.ts`
  - `desktop/src/bun/tool-result-error.test.ts`
  - `desktop/src/bun/native-stream-projection.test.ts`
- Verification before handoff:
  - `bun test`: 171 passed, 0 failed.
  - `bun run typecheck`: passed.
  - `graphify update .`: passed; 949 nodes, 1746 edges, 64 communities.

## Immediate next actions

1. Reproduce against the effective tool assembled by the real `Agent`, not the helper in isolation. The likely issue is that Agent-level `workspace` automatically injects its own native tool after the explicit `tools` catalog and overwrites the patched tool with Mastra's original schema.
2. Add an integration assertion around `Agent.prepare()` or the installed agent tool-preparation path that inspects the final `mastra_workspace_execute_command.inputSchema` and parses the exact string-valued payload above. A helper-only unit test is insufficient.
3. Inspect installed Mastra source where assigned tools and workspace tools are merged. Determine precedence before changing architecture. Search installed `@mastra/core` 1.56.0 source/types; embedded docs are authoritative for this pinned version.
4. Prefer an upstream-native solution if available. If no Agent-level repair callback or workspace schema override exists in 1.56.0, choose one of these explicit paths and test it end to end:
   - remove automatic workspace-tool injection and supply the patched `createWorkspaceTools(agentWorkspace, ...)` catalog explicitly while preserving workspace instructions/context; or
   - patch/upgrade Mastra once upstream makes `tail` use the same preprocessing as `timeout`.
5. Launch the real desktop app, approve the exact `git status` call, and verify the command actually runs. Also test a genuinely invalid value such as `tail: "many"` remains rejected and appears as Failed, not Completed.

## Decisions and evidence

- Installed package: `@mastra/core` 1.56.0.
- Installed declaration `desktop/node_modules/@mastra/core/dist/workspace/tools/execute-command.d.ts` shows:
  - `timeout: z.ZodOptional<z.ZodNullable<z.ZodPreprocess<z.ZodNumber>>>`
  - `tail: z.ZodOptional<z.ZodNullable<z.ZodNumber>>`
- Mastra's internal AI SDK contains `repairToolCall`, but the installed public `AgentExecutionOptionsBase` does not expose it. Do not wire undocumented SDK internals into Proteus.
- Keep Mastra's native Workspace, LocalSandbox, approval, and execution pipeline. Do not build a custom shell runner.
- Structured tool output is a second, independent bug: `{ status: "completed", output: { error: true } }` must project as an error even when input coercion is later solved.

## Risks and gotchas

- The current helper test proves the patched schema works in isolation, not that the final Agent catalog uses it. This is the central open risk.
- Restart the desktop Bun process for every manual retest; Vite UI refresh alone cannot reload Bun runtime code.
- Every command requires native approval and executes through `LocalSandbox` with `isolation: "none"` on Windows. Do not weaken approval.
- No Docker is available on this laptop.
- Preserve unrelated framework-first work: native queueing, approval/suspension, task signals, memory, provider selection, and workspace ownership.
- Never expose credentials through diagnostics or command output.

## Relevant files and docs

- `desktop/src/bun/runtime.ts` — Agent and workspace construction, final dynamic tool catalog, persisted projection.
- `desktop/src/bun/workspace-tool-compat.ts` — attempted numeric-string compatibility layer.
- `desktop/src/bun/native-stream-projection.ts` — live tool lifecycle projection.
- `desktop/src/bun/tool-result-error.ts` — shared structured-error recognition.
- `desktop/src/bun/workspace-policy.ts` — native workspace tool allowlist and approvals.
- Installed Mastra docs: `desktop/node_modules/@mastra/core/dist/docs/references/docs-workspace-overview.md` and `docs-agents-using-tools.md`.
- Installed Mastra schema: `desktop/node_modules/@mastra/core/dist/workspace/tools/execute-command.d.ts`.
- Repository rule: run `graphify update .` after source changes.

## Definition of done

- The exact string-valued real-chat payload executes successfully after approval.
- Invalid nonnumeric values are still rejected safely.
- Live and restored history both show validation/execution failures as Failed.
- The effective final Agent tool-schema integration test passes.
- Full `bun test`, `bun run typecheck`, and `graphify update .` pass.
