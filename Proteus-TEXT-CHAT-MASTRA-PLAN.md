# Proteus text chat + native Mastra runtime

This is the implementation record for the native Mastra text-chat backbone.

## Runtime ownership

- One retained `Mastra` application registers the Proteus `Agent`, `Memory`, contained plan `Workspace`, gateways, storage, and `TaskSignalProvider`.
- The desktop shell shuts the retained Mastra application down on quit so workspace and LibSQL handles are released.
- `NativeAgentDriver` is a thin UI adapter over `subscribeToThread`, `queueMessage`, `sendStreamResume`, `sendToolApproval`, `listSuspendedRuns`, and the subscription abort function.
- Normal sends, queued sends, retries, and continuations all enter Mastra through `queueMessage`. Queue state comes from Mastra's accepted `wake` or `deliver` action.
- There is no application-owned steering queue and no AgentController session in the live runtime.

## Durable state rules

1. Mastra `Memory` owns threads and messages. The UI only projects those records.
2. `TaskSignalProvider` owns tasks in Mastra's `threadState` domain; thread metadata never overwrites native task state.
3. Persisted Mastra tool message parts own historical tool status and output. In-memory outcomes exist only to bridge an active stream until memory catches up.
4. `listSuspendedRuns({ threadId, resourceId })` is the durable source for pending plan/question recovery after restart.
5. Plan approval resumes with `sendStreamResume`. Approved plans pass `streamOptions.activeTools` without `submit_plan`, preventing approval loops in the resumed run.
6. `proteus.ui.v2` metadata contains UI-only state. Legacy `proteus.workbench.v1` metadata is read during migration, while duplicated task/tool fields are stripped on write.

## Framework-first boundaries

- `submitPlanTool`, `askUserTool`, `TaskSignalProvider`, `Memory`, `Workspace`, `LibSQLStore`, and native Agent thread/message APIs come from the installed Mastra packages.
- Shared RPC contracts remain a presentation boundary; they do not implement a second run, queue, task, or suspension engine.
- Diagnostics are local and optional. No Mastra observability backend is configured.

## Backlog

- External actions/connectors and durable action receipts.
- Subagent/delegation support.
- Advanced memory controls and semantic recall UI.
- Concurrent visible runs across multiple conversations.
- Transcript search/virtualization, export, feedback, voice, image, and multimodal input.
