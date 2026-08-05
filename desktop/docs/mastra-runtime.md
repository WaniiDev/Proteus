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

## Plan approval boundary

`read_plan` and `write_plan` operate only inside the contained private plan workspace and receive documented Session grants, so they never create a second generic approval checkpoint. `submit_plan` remains the sole human checkpoint and uses Mastra's native suspension/resume data.

The default conversation mode transitions to an approved-plan mode on approval. That mode excludes `write_plan` and `submit_plan`; rejection stays in the conversation mode so the model can revise and resubmit. Mastra 1.56 can carry the prior mode's tools into the resumed step, so the same approved-mode allowlist is re-applied through the documented `prepareStep.activeTools` boundary. A later top-level user message restores the conversation mode while preserving the selected model.

PROTEUS exposes one model selection even though Mastra stores models per mode. A user selection is persisted to both internal modes with the documented `session.model.switch({ modelId, modeId, scope: "thread" })` API, and approval backfills the target mode before Mastra performs its native transition. Restoring conversation mode relies on Mastra's saved per-mode model and never copies the outgoing execution-mode model over it.

The contained plan filesystem is an available internal capability, not an external action. An explicit request to create, write, show, test, or demonstrate a plan—including placeholder plans—must write one Markdown draft with `write_plan` and submit that path once with `submit_plan`; the assistant must not claim plan-file writing is unavailable after a successful write.

`Session.displayState.pendingSuspensions` and `Session.suspensions` are authoritative for live plan cards. Plan Markdown is hydrated once per unique tool-call ID, and repeated display snapshots preserve the existing version and `resolving` status. A response is accepted only after the native resume boundary completes without an emitted error; terminal tool events and canonical history are used as stronger evidence when the installed runtime provides them.

Mastra 1.56 does not emit `tool_end` for a resumed `submit_plan` call. After the successful native resume boundary removes that suspension, PROTEUS projects the original visible tool-call ID to `completed`; it never settles the row before Mastra confirms the resume.

## Compatibility boundary

`runtime.ts` projects Mastra state into the desktop IPC snapshot. This layer may sanitize tool payloads and shape display data, but it must not duplicate Mastra lifecycle ownership. The OpenRouter catalog endpoint remains provider-specific because the product displays modality and descriptive metadata outside Mastra's `AvailableModel` contract; selection still uses `Session.model.switch()`.

## Primary providers

OpenRouter and Codex are alternative primary providers. A conversation persists its provider, provider model ID, and optional reasoning effort in the existing thread metadata. There is no provider delegation and no silent fallback to OpenRouter.

OpenRouter continues through `AgentController` and `Session.sendSignal()`. Its catalog is merged into the provider-neutral snapshot, and supported reasoning effort is read from OpenRouter's per-model `reasoning.supported_efforts` metadata. The chosen effort is attached to the user signal as `providerOptions.openrouter.reasoning.effort`, using Mastra's documented provider-options boundary.

Codex uses MastraCode's upstream `MastraCodeGateway` with `routeThroughMastraGateway: false`. The gateway owns ChatGPT OAuth authentication and constructs the OpenAI Codex language model; PROTEUS does not implement a second provider client. The same `Agent`, `AgentController`, and `Session.sendSignal()` path handles Codex and OpenRouter, so instructions, tasks, plans, approvals, memory, history, steering, cancellation, and display events have one lifecycle owner.

The upstream `createModelCatalogProvider()` supplies authenticated OpenAI catalog entries. PROTEUS filters that catalog to GPT-5-family models, applies MastraCode's `remapOpenAIModelForCodexOAuth()`, and exposes stable product IDs as `codex/<model>`. Mastra's internal session modes receive `openai/<model>` through the documented `session.model.switch({ modelId, modeId, scope: "thread" })` API. Legacy ACP composite selections are migrated once to a stable model ID plus separate reasoning effort.

Codex reasoning uses MastraCode's public `ThinkingLevel` contract (`low`, `medium`, `high`, `xhigh`) and defaults to `medium`. A gateway instance is resolved for each run with the conversation's current thinking level. GPT-5 reasoning floors and provider request shaping remain upstream behavior.

## ChatGPT OAuth and credential boundary

MastraCode's `loginOpenAICodex()` owns browser callback and device-code authorization. PROTEUS exposes progress only as provider, mode, status, URL, user code, instructions, and a safe error. Browser authorization opens through Electrobun, supports manual callback URL/code entry, and can be cancelled; device authorization is the fallback for blocked localhost callbacks.

OAuth access/refresh credentials are serialized only into the `openai-codex.oauth` Windows Credential Manager account through an injected structural `CredentialStore`. `allowEnvironmentFallback` is false, expired-token refresh uses upstream `refreshOpenAICodexToken()`, and concurrent refreshes share one in-flight promise. Tokens, account IDs, and raw OAuth failures never enter IPC snapshots, messages, logs, thread metadata, or plan files. Disconnect clears only the Codex credential and never silently selects or invokes OpenRouter.

OpenRouter uses the separate `openrouter.api-key` keyring account. Existing installations migrate the legacy `openrouter` account on first read without writing plaintext files.

## Desktop packaging

The Electrobun Bun bundle contains MastraCode's OAuth gateway runtime. MastraCode's optional Stagehand and Playwright browser subsystems are external because PROTEUS does not enable them; no ACP adapter or Codex executable is copied into the application.

## Storage cutover

The v2 runtime uses `proteus-v2.db` and `proteus-plans-v2`. On first launch, an allowlisted, idempotent cutover removes only `proteus.db`, its WAL/SHM companions, and `proteus-session.json`, then writes `proteus-mastra-v2.cutover`. Windows Credential Manager data is not touched.

## Required gate

Every runtime phase must pass `bun test`, `bun run typecheck`, and the production build before commit. Run `graphify update .` after source changes.
