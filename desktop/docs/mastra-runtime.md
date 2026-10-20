# Mastra runtime ownership

Proteus (Mastra 1.78: `@mastra/core` 1.78.0 with the `@mastra/*` packages pinned in `desktop/package.json`; Electrobun 2.0.4) uses the installed Mastra `Agent` as its run, queue, suspension, history, memory, task, and storage backbone. The desktop runtime is an adapter: it projects framework state into an Electrobun IPC snapshot and never maintains a second run lifecycle.

- `Agent.queueMessage()` and `Agent.subscribeToThread()` own queued and active turns.
- `Agent.listSuspendedRuns()` is the canonical recovery source for both `requireApproval` calls and tools paused with `suspend()`.
- `Agent.sendToolApproval()` resolves `requireApproval` calls. `Agent.sendStreamResume()` resolves `ask_user` and `submit_plan` suspensions.
- Every response includes the exact `toolCallId`; Proteus never relies on Mastra's most-recent-call fallback.
- Persistent LibSQL storage supplies canonical message history and suspended run snapshots. `toAISdkV5Messages()` converts stored history for rendering.
- `TaskSignalProvider` owns task state and supplies the native task tools and task-state input processor.
- A resolver-backed `Workspace` supplies native filesystem and command tools. Proteus builds a server-owned `RequestContext` for every idle wake; the renderer never supplies a filesystem root.
- Plan drafts remain in a separate contained `Workspace`. Its native read/write capabilities are exposed privately as `read_plan` and `write_plan`.

## Workspace boundary

Conversations can be pinned. `threads.pin` (`{ threadId, pinned }`, answered `{ accepted }`) calls `TextRuntime.pinThread`, which stores `{ pinnedAt }` under its own thread metadata key (`proteus.pin.v1`) next to the title and the UI state, so renames and UI-state saves keep it and a pin survives a restart. `ThreadSummary` carries `pinned` (default `false`) and `pinnedAt` (ISO string or `null`). The snapshot lists pinned threads first, by `pinnedAt` descending, then the rest by `updatedAt` descending; the renderer groups Pinned, Today and Earlier from that. Pinning does not require an idle runtime, re-pinning keeps the original `pinnedAt`, and an unknown thread rejects (`accepted: false`).

Each conversation has a workspace binding: either the private Proteus app workspace or one attached project folder. `threads.workspace.select` can change that binding only while the conversation is canonically empty and idle; `TextRuntime` rejects busy, queued, suspended, optimistic, non-empty, and unavailable-project cases. After the first message, the binding is immutable. Existing conversations migrate to the app workspace. Project records live in a Mastra `FactoryStorageDomain`; conversation metadata stores only the binding. If an attached folder is moved, deleted, or forgotten, the chat becomes explicitly unavailable until the user reconnects it. Proteus never silently redirects it to the app workspace.

`RequestContext` carries the trusted thread ID, workspace kind, and canonical root from the Bun runtime into `Agent.queueMessage()` through `ifIdle.streamOptions`. A dynamic `LocalFilesystem` is constructed with `contained: true`, so traversal and symlink escapes outside that root are rejected by Mastra.

`WorkspaceRegistry` (the UI file operations) resolves the nearest existing ancestor of every path, including missing write/move/copy/mkdir destinations, rejects it when it leaves the root, rejects destinations that are themselves symlinks or junctions, and re-checks the parent after `mkdir`.

The filesystem tool allowlist is deny-by-default:

- Read, list, stat, and grep run automatically.
- Write and edit require approval and Mastra's `requireReadBeforeWrite` protection.
- Directory creation and deletion require approval.
- AST editing, indexed search, LSP, browser, and skills are not enabled.

Commands use a resolver-backed `LocalSandbox`, keyed by conversation ID for background-process continuity. Execute and kill require approval; reading process output does not. Resolver-created filesystem and sandbox providers are owned and destroyed by Proteus. On Windows, `LocalSandbox` uses `isolation: "none"`: commands run on the host from the selected working directory, so the approval card and agent instructions state that limitation explicitly.

The Mastra `AgentController` beta API is deliberately not part of this runtime. Its controller session state and grants are process-local when evaluated (Mastra 1.56) and the architecture test still forbids it, while Proteus requires approvals to survive refreshes and restarts.

## Approval and suspension boundary

Mastra has two distinct human-in-the-loop paths and Proteus preserves that distinction:

1. A tool configured with `requireApproval: true` emits `tool-call-approval`. Proteus shows the emitted tool name and exact arguments, then calls `sendToolApproval()` with the stored `toolCallId`.
2. A tool calling `suspend()` emits `tool-call-suspended`. `ask_user` resumes with schema-valid answer data; `submit_plan` resumes with `{ action: "approved" | "rejected", feedback? }`.

Before applying any decision, Proteus re-runs `listSuspendedRuns()` for the conversation and requires an exact thread, run, and tool-call match. Generic approvals also carry a stable SHA-256 fingerprint of the canonical tool name and arguments shown to the user. If the current stored request differs, the old approval is rejected. The renderer receives only this projected pending-action state; historical message metadata is never treated as proof that an action remains pending.

The response RPC waits until Mastra accepts `sendToolApproval()` or `sendStreamResume()`. It does not wait for the resumed model turn or tool execution to finish. This is the framework's acknowledgement boundary and prevents both false “failed” results after a successful response and premature UI completion.

Pending actions use one UI model for approvals, questions, and plan review. Multiple tool calls remain distinct by `runId` plus `toolCallId`; resolving one cannot overwrite another. A refresh or process restart reconstructs them from Mastra storage.

After Mastra acknowledges a decision, Proteus immediately removes the pending card and records one correlated continuation containing only interaction, tool-call, thread, run, decision kind, phase, and timestamps. Answers and tool arguments are never persisted in this record. Declines are projected before generic tool completion, including Mastra's canonical denial output, so a denied tool is visibly declined and cannot appear completed. Approved tool calls remain running until their real result arrives. Proteus never replays an accepted decision automatically.

Only events after the decision count as continuation progress; the suspended step's trailing `step-finish` is ignored. After 30 seconds without progress the UI shows a non-blocking warning. After two minutes, and also after startup or an unterminated stream close/error, Proteus reconciles durable message history and `listSuspendedRuns()`: completed history settles the UI, an exact suspension restores an explicit retry card, an active subscription remains running with Stop available, and missing state becomes a retryable error. A successful continuation with no follow-up text returns to idle with a completion note.

Session-scoped “trust this tool” grants remain backlog work. They must not be added until they can be made durable without reintroducing an independent approval lifecycle.

## New-chat workspace behavior

The sidebar New chat action has no workspace modal. It inherits the current conversation's binding exactly once, and the runtime revalidates project availability before creating and selecting the new conversation. Missing projects are blocked with reconnect guidance; creation failures retain the current conversation and view. The empty composer keeps its workspace selector until the first message, and the Projects view keeps its explicit project-bound New chat action.

## Plan boundary

`write_plan` is a private contained-workspace operation and does not require a second approval. `submit_plan` is the sole plan checkpoint and uses Mastra's native suspension/resume contract. Approval resumes with the approved implementation-tool allowlist; rejection leaves plan authoring available for revision.

Plan Markdown is hydrated from the contained plan filesystem. Repeated suspension projections preserve the existing interaction state and version. A plan tool row is not marked complete until Mastra accepts the resume and the canonical stream/history settles it.

## Task boundary

`TaskSignalProvider` and its store remain the only durable task-state source. Proteus may reject duplicate/no-op mutations at the agent hook boundary and project native task signals onto historical tool rows, but it does not persist a parallel task machine or rewrite stored Mastra messages.

Historical rendering removes only artifacts emitted by the retired task-loop guard when an identical successful call already exists in the same turn. Genuine native task errors remain visible.

## Generative answers (`show_answer`)

The agent answers with interface through one tool, `show_answer` (`src/bun/tools/show-answer-tool.ts`), registered in `runtime/agent-factory.ts`. Its input schema is the catalog v2 zod schema in `src/shared/answer-catalog.ts` (`{ v: 2, title, blocks }`, strict, every ADR 0003 block limit and a plain-text rule on every string), shared with the renderer along with `validateBlock` and `validateAnswer`. A block that breaks its limits fails the tool input validation, so Mastra returns the schema error to the model.

Composition rules (headline first and once, `sources` then `suggest` last, at most 10 blocks, one primary action, one `choice`, one `diff`) are checked when the call ends. The tool only acknowledges (`{ ok: true, shown: true }`); the UI reads the streamed input. On a composition failure the first result is `{ ok: false, retry: true, error }`; a second consecutive failure on the same thread returns `retry: false` and instructs the model to answer in prose, and a valid answer or that fallback resets the count. The person never sees a rejected answer. The agent instructions carry the ADR line that chooses between `show_answer` and prose.

### Answer items in the snapshot

`show_answer` is projected as an `answer` message part (`chatAnswerPartSchema` in `src/shared/contracts.ts`): `{ answerId, toolCallId, title, question, blocks, streaming, outcomes }`. `answerId` is the tool call id. `question` is the text of the user message that opened the turn (filled when messages are mapped from storage, empty on the live stream). `outcomes` is a record keyed by block or row id (`"Approved"`, `"Opened"`, `"Chosen · …"`, `"Not now · unchanged"`); it is empty now and is filled when answer actions land (WAN-530).

While the call streams, `NativeStreamProjector` buffers the `tool-call-delta` input text per tool call and reads it with `parsePartialJson` (`src/bun/native/partial-json.ts`), so only closed nodes are ever read. `projectAnswerText` (`src/bun/native/answer-stream.ts`) then projects:

- a block only once it is closed and passes `validateBlock`; no half-parsed block reaches the snapshot;
- rows of `list`, `timeline`, `table` and `progress` items one at a time, once the block's own fields are closed and the block is valid with the rows received so far (a row that would break the block waits for the block to close);
- a closed block that fails validation as `{ type: "fallback" }` (the renderer shows one line; later blocks continue).

`tool-call` (complete input) re-projects the whole input and sets `streaming: false`; `finish`, `abort` and `error` also end streaming. A rejected result (`{ ok: false }`, a tool error or a failed result) removes the answer part and leaves an ordinary failed `show_answer` tool step, so the person never sees a rejected answer and the retry streams a new answer item.

History: the stored tool call maps back to an answer item in `toolPart` (`runtime/message-mapping.ts`) with `projectAnswerInput`, which validates each block the same way, from the unsanitized stored input (sanitizing truncates nested rows). A reload therefore yields the same blocks as the finished stream; a stored rejection reloads as the failed tool step.

## Providers

OpenRouter and Codex are alternative primary model providers. The chosen provider, model, and reasoning effort are persisted with each conversation; the most recently chosen combination seeds new conversations without changing existing ones. There is no silent fallback to OpenRouter.

Codex uses MastraCode's `MastraCodeGateway` with `routeThroughMastraGateway: false`. MastraCode owns ChatGPT OAuth and model construction. Credentials remain in Windows Credential Manager and never enter IPC snapshots, messages, diagnostics, thread metadata, or plan files.

## Module layout

`TextRuntime` (`src/bun/runtime.ts`) is a thin facade: it wires Mastra, storage and the services below and keeps the public methods `index.ts` calls. All behaviour lives in `src/bun/runtime/`. `RuntimeContext` owns the state shared across services: the snapshot, selection, per-thread state cache, the single run marker and the message and interaction bookkeeping. State used by only one service is private to it:

- `ThreadService`: `savedState` (last state the store accepted, the rollback target), `unverified` (default-guess states for never-loaded threads, never saved), `threadWriteQueues` (per-thread save serialization), `threadSwitchQueue`.
- `ContinuationService`: `tracks` (per-thread slow and recovery timers and progress).
- `InteractionService`: `hydratingPlans` and `hydratedPlans` (plan Markdown loading).
- `ProviderService`: Codex auth (`codexAuthAbortController`) and `modelUsage`.

- `context.ts`: the shared state: the snapshot and its `publish`, selection, per-thread state cache, the single run marker (`runId`/`runThreadId`), optimistic and live-projected messages, pending-interaction bookkeeping, the composer mutation queue.
- `thread-service.ts`: thread CRUD, selection and the switch queue, `stateFor`/`updateThreadState`, persisted thread state (write queue, rollback), `syncThreadState`/`syncMessages`.
- `provider-service.ts`: OpenRouter and Codex auth, credential validation, model catalog, model and reasoning selection.
- `workspace-service.ts`: workspace binding, project registry, the server-owned per-thread `RequestContext`.
- `memory-service.ts`: scoped durable memory settings and entries.
- `interaction-service.ts`: `ask_user`, plan and tool-approval responses, resolving and failed bookkeeping, plan hydration.
- `continuation-service.ts`: a resumed run after a decision: progress, slow and recovery timers (per thread), reconciliation.
- `run-coordinator.ts`: native stream projection, send, queue, retry, continue and abort.
- `message-projector.ts`, `message-mapping.ts`: Mastra message to chat message mapping; `agent-factory.ts`: the `Agent` definition; `constants.ts`, `types.ts`: shared constants and types.

Other backend modules are grouped by feature under `src/bun/`: `core/` (projection, error mapping, diagnostics, Mastra foundation, instructions, legacy cutover), `native/` (agent driver, stream projection, thread repository, tool-call guard), `providers/` (OpenRouter, Codex, auth, readiness, model preferences, credentials), `workspace/` (workspace registry and policy, tool compat, project registry), `memory/` (settings, tools, scoped memory) and `tools/` (approval, task and plan policy, tool decisions, working tools, ask-user). Error normalization lives in `core/runtime-error-mapping.ts`; the OpenRouter gateway lives in `providers/openrouter.ts`.

## Initialization and thread load failures

`initialize()` runs storage, preferences, diagnostics, legacy cutover and thread sync, then continues to the provider and credential steps (Codex model refresh, stored credential validation) even when loading the thread state fails. Thread sync publishes the thread list before loading the target thread. If a thread metadata read fails, the runtime keeps the previous selection (or clears it when that thread is gone), surfaces a retryable error and records a `thread_state_load` diagnostic; nothing is cached for the failed thread, and it never defaults the thread to the app workspace, because that would silently redirect an attached project conversation. Startup only records the failure and continues; an explicit `selectThread` or `createThread` whose target fails to load rejects (the RPC answers `accepted: false`) without subscribing to the target. A retry whose clone cannot be loaded and selected rejects, deletes the clone and republishes the thread list, so no stale "· retry" entry remains. `deleteThread` drops the deleted thread even when loading the next one fails, and both delete (even a failed one) and retry-clone cleanup forget the thread's saved state and continuation track.

## Storage and packaging

The runtime uses `proteus-v3.db`, `proteus-plans-v2`, and the app-owned `proteus-workspace-v1` directory. A one-time allowlisted cutover removes only legacy v1 database/session files. Credential Manager data is untouched.

The Electrobun bundle includes the MastraCode OAuth gateway runtime. Optional Stagehand and Playwright subsystems are external because Proteus does not enable them. Docker is not required.

## Backlog

- Evaluate search, skills, AST editing, and LSP separately before expanding the explicit Workspace allowlist.
- Add durable session-level trust when Mastra provides a restart-safe native grant path or a deliberately scoped persistence design is approved.
- Keep observability backends out of scope; local diagnostics remain sufficient for this application.

## Required gate

Each implementation phase must pass its focused tests and typecheck before commit. The final phase runs `bun test`, `bun run typecheck`, and the production build.
