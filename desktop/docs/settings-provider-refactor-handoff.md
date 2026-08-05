# Handoff: Settings, providers, and model controls refactor

_Research handoff for the next implementation agent - 2026-08-04 - repository `WaniiDev/Proteus`, branch `main`_

## Objective

Refactor Settings into a tabbed provider/model experience where OpenRouter and Codex are equal, user-selectable primary providers. Both must use the same PROTEUS chat, history, plan/task, approval, workbench, stop, and error UX. There is no provider-to-provider delegation.

## Current status

Implementation completed on `main` on 2026-08-05. Phases 1-5 were committed independently; Phase 6 contains final documentation, graph refresh, verification, and delivery.

Important research correction: the official Codex ACP adapter advertises model-and-reasoning combinations directly (for example `gpt-5.6-sol[high]`). The implementation therefore uses public `AcpAgent.setModel()` with those IDs instead of the provisional `CODEX_CONFIG.model_reasoning_effort` workaround described later in this original handoff.

Implementation commits:

- `2f86df2` — packaged Codex ACP support.
- `484a9e9` — provider-neutral contracts and per-thread selection.
- `ab67ea6` — native Codex ACP provider runtime.
- `c88cfa5` — provider-native reasoning controls.
- `f86c6d1` — Settings provider/model UI revamp.

Original pre-implementation handoff follows for audit history.

Research and implementation planning are complete; implementation has not started. The working tree was clean and synchronized with `origin/main` at `59b3cf3` before this handoff document was added.

Baseline verification:

- `bun test`: 87 passed, 0 failed.
- `bun run typecheck`: passed.
- Vite production compilation passed. Electrobun packaging then failed with `EACCES` while deleting `desktop/build/dev-win-x64` because a running development app had that directory locked; this was not a source failure.
- No Docker is available on this machine.

## Research completed

- Current Settings is a single OpenRouter-only component in `src/mainview/App.tsx` with API-key controls and a native model `<select>`.
- `src/shared/contracts.ts` has singular OpenRouter-only credential, model, and selection fields/RPCs.
- `src/bun/runtime.ts` uses Mastra `AgentController`, `TaskSignalProvider`, native plan/task policy, Mastra memory/storage, and an OpenRouter-scoped `ModelsDevGateway`.
- OpenRouter model selection is synchronized through Mastra session/model APIs; new provider work must preserve the existing plan/task lifecycle instead of replacing it.
- The current workspace exposes only contained private plan drafts. The Projects page is still a placeholder; there is no shared general-purpose coding workspace yet.
- Installed Mastra versions include `@mastra/core@1.55.0`; `@mastra/acp` is not installed. Current `@mastra/acp@0.4.0` is peer-compatible with this core version.
- The current machine has `codex-cli 0.144.3` and is logged in through ChatGPT.

Framework findings:

- Use Mastra's native [`AcpAgent`](https://mastra.ai/reference/acp/acp-agent) from `@mastra/acp`, not a custom Codex execution engine.
- Use the current official [`@agentclientprotocol/codex-acp`](https://github.com/agentclientprotocol/codex-acp), initially pinned to `1.1.9`. The older Zed adapter is deprecated/replaced.
- The official adapter supports ChatGPT/API-key auth, models, reasoning effort, approval, sandbox mode, plans, TODOs, tool events, and cancellation.
- Reuse the existing local ChatGPT login. Prefer the adapter's bundled Codex dependency instead of forcing the older globally installed binary through `CODEX_PATH`.
- `AcpAgent.getAvailableModels()` and `setModel()` are public. `AcpAgent.connection.promptStream()` yields complete ACP session updates.
- Mastra's current `AcpAgent.stream()` converts ACP text and `tool_call`/`tool_call_update`, but drops richer plan/reasoning/session updates. Normalize the raw public `promptStream()` events into existing PROTEUS display contracts.
- Mastra does not publicly expose ACP session-config setters such as Codex reasoning effort. Use the official adapter's `CODEX_CONFIG.model_reasoning_effort` at session creation; recreate only an idle Codex connection when that setting changes. Do not reach into private ACP connection/session fields.
- Always provide `onPermissionRequest`. Mastra's default selects the first permission option, which is unsafe for PROTEUS; route it through the existing approval UI.
- OpenRouter reasoning can be sent natively through `providerOptions.openrouter.reasoning`. Extend `/models/user` mapping with `supported_parameters` and optional `reasoning` metadata per the [OpenRouter reasoning guide](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

## Locked product decisions

- OpenRouter and Codex are alternative primary providers with equal visible capabilities.
- Do not implement hidden delegation between providers.
- Add two Settings tabs: **Providers** and **Models**.
- Build a custom PROTEUS model picker with search, provider filters, model cards, selected state, context/pricing metadata, capability badges, and keyboard accessibility.
- Reuse local Codex ChatGPT authentication, with a Settings sign-in/reconnect action only when authentication is absent.
- Persist provider/model/reasoning per conversation; Settings edits the active idle conversation and supplies defaults for new conversations.
- Do not silently fall back to OpenRouter or Auto Router when Codex fails.
- Do not silently grant Codex broader filesystem/shell authority than OpenRouter. Keep Codex read-only except for capabilities represented by the shared PROTEUS approval policy until a shared project workspace exists.

## Ordered implementation plan

### Phase 1 - ACP compatibility and packaging spike

1. Add `@mastra/acp@0.4.0` and `@agentclientprotocol/codex-acp@1.1.9`.
2. In a temporary read-only workspace, verify startup, local-login reuse, model discovery/selection, streaming, cancellation, and a cancelled permission request.
3. Verify protocol compatibility: Mastra ACP currently depends on ACP SDK `0.21`, while the Codex adapter uses SDK `1.3`. If the handshake fails, pin the newest compatible official adapter release; do not build a custom ACP client or use the deprecated Zed package.
4. Establish a production-safe Windows launcher and copy/package the matching official Codex binary through `electrobun.config.ts`. The shipped app must not depend on globally installed Bun, npm, or Codex.
5. Add a packaged-launch smoke test.
6. Verify focused tests, typecheck, development launch, and production packaging after stopping the running app.
7. Commit: `chore(runtime): verify packaged Codex ACP support`.

### Phase 2 - Provider-neutral contracts and persistence

1. Replace OpenRouter-only snapshot fields with provider IDs, provider connection states, provider-neutral model descriptors, reasoning capabilities, and selected provider/model/reasoning.
2. Retain pricing/context/modalities as optional model metadata.
3. Persist provider/model/reasoning with conversation state and add defaults for new conversations.
4. Replace singular credential/model RPCs with provider-aware connect, disconnect, refresh, select-model, and select-reasoning requests.
5. Migrate old state to an OpenRouter selection without losing messages, plan history, tasks, or interactions.
6. Test schema migration, snapshot transport, invalid provider/model combinations, thread switching, and busy-state rejection.
7. Commit: `refactor(runtime): add provider-neutral model contracts`.

### Phase 3 - Equal primary-provider runtime

1. Extract a provider boundary for authentication/catalog, start-turn, stream events, abort, model changes, and error normalization.
2. Keep the existing Mastra `AgentController` path as the OpenRouter implementation.
3. Add Codex as a primary backend using `AcpAgent`, with one live ACP connection per active conversation.
4. Keep Mastra storage as canonical history. On cold start, seed Codex once from a provider-neutral transcript; do not resend complete history on every turn.
5. Normalize ACP text, reasoning summaries, plans, TODO/task changes, tool calls/results, usage, cancellation, and terminal states into existing messages/events/workbench structures.
6. Route ACP permissions through the current approval card, resolving every request exactly once.
7. Test ordering, thread switches, restart rehydration, stop/cancel, approvals, failed tools, plan/task completion, and provider-specific errors.
8. Commit: `feat(runtime): add Codex as a primary ACP provider`.

### Phase 4 - Model and thinking controls

1. OpenRouter: parse `supported_parameters` and optional `reasoning`; show exact advertised effort levels, mandatory/default behavior, and Auto when precise levels are unavailable.
2. Send OpenRouter settings through the existing Mastra user signal as `providerOptions.openrouter.reasoning`.
3. Codex: use `getAvailableModels()` and offer Auto plus supported `none|minimal|low|medium|high|xhigh` reasoning choices.
4. Initialize Codex with `CODEX_CONFIG.model_reasoning_effort`; recreate only an idle connection on changes while preserving PROTEUS history.
5. If a model rejects an effort, revert to Auto and surface an actionable model-setting error.
6. Never persist or expose hidden chain-of-thought; render only provider-supplied summaries/normal stream parts.
7. Test metadata mapping, payloads, defaults, mandatory reasoning, unsupported-effort recovery, persistence, and session recreation.
8. Commit: `feat(models): add provider-aware thinking controls`.

### Phase 5 - Settings UI revamp

1. Replace the single page with accessible Providers and Models tabs.
2. Providers tab: OpenRouter key/status controls and Codex login/adapter/version/readiness controls with loading, error, and retry states.
3. Models tab: custom searchable/filterable model cards, metadata, selected state, and reasoning controls.
4. Disable provider/model/reasoning changes during an active run.
5. Match existing PROTEUS typography, borders, spacing, pastel states, responsive behavior, and reduced-motion rules.
6. Test tab semantics, focus/keyboard behavior, filtering, connection states, selection, reasoning, and responsive layout.
7. Commit: `feat(settings): revamp provider and model settings`.

### Phase 6 - Integration and delivery

1. Update `docs/mastra-runtime.md` with provider routing, ACP lifecycle, permissions, history ownership, reasoning, and packaging.
2. Run `bun test`, `bun run typecheck`, stop the development app, then run `bun run build`.
3. Smoke-test both providers through normal chat, tasks, plan approval, tool activity, cancellation, thread switch/restart, and provider/model/reasoning changes.
4. Verify credentials, auth tokens, private reasoning, and sensitive ACP stderr are never persisted in snapshots.
5. Run `graphify update .`.
6. Confirm a clean worktree and push `main` to `origin/main`.

## Key files

- `src/mainview/App.tsx` and mainview styles: Settings UI and current model controls.
- `src/shared/contracts.ts`: runtime snapshot and RPC contracts.
- `src/bun/runtime.ts`: Mastra controller, provider/model selection, history, plan/task projection, and approvals.
- `src/bun/openrouter.ts`: OpenRouter validation/catalog mapping.
- `src/bun/index.ts`: RPC wiring.
- `electrobun.config.ts` and `package.json`: ACP dependencies and production packaging.
- `docs/mastra-runtime.md`: framework architecture documentation.

## Risks and gotchas

- Do not access private fields inside Mastra's ACP connection to manipulate session configuration.
- Do not omit `onPermissionRequest`.
- Do not change provider/model/reasoning during active work.
- Preserve current native Mastra task and plan semantics; do not reintroduce custom task/plan tools.
- Treat ACP event IDs and terminal states as authoritative; avoid duplicating the historical tool-loop bugs.
- The current build directory may remain locked while the Electrobun development app is running.
- Read current Mastra/ACP documentation again before every framework-related phase because these packages are new and evolving.

## Definition of done

- Users can connect OpenRouter or reuse a local Codex ChatGPT login.
- Users can select either provider and its models through the custom Settings UI.
- Supported thinking levels are applied truthfully and persist correctly.
- Both providers produce the same PROTEUS message, tool, task, plan, approval, workbench, cancellation, history, and error experience.
- Restarts and thread switches preserve provider/model/reasoning and do not duplicate events.
- All tests, typecheck, production build, provider smoke tests, and Graphify update pass.
- Each phase is committed independently and final `main` is clean and pushed.
