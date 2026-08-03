# PROTEUS text chat + Mastra Workbench

This is the durable implementation record for the first production slice: an OpenRouter-only text chat that is reliable end to end and uses Mastra Core for the run lifecycle.

## Delivered contract

- OpenRouter is the only model gateway exposed by the desktop runtime.
- Mastra AgentController owns the active text run, streaming messages, token usage, task state, follow-up lifecycle, and native suspensions.
- `ask_user` and task tools are enabled through the controller mode allowlist. `subagent`, workspace tools, and external action tools remain disabled.
- `submit_plan` is a PROTEUS inline suspension adapter. It keeps the Mastra suspend/resume contract but does not grant the agent filesystem write access.
- Human-in-the-loop cards render in the main transcript. The Workbench is a read-only operational ledger with links back to those cards.
- One run may be active at a time. Follow-ups are an editable PROTEUS-owned FIFO queue; steering clears native/app follow-ups into a recoverable “Cleared by steering” list.
- Retry, stop, continue, copy, Markdown/GFM rendering, smart latest-message scrolling, per-conversation Workbench state, and local first-message titles are part of the text-chat slice.

## Mastra adapter rules

1. Project `session.displayState` immediately into plain RPC data; Mastra reuses and mutates the same display-state object.
2. Keep the UI-selected thread separate from the Mastra-bound run thread because `session.thread.switch()` aborts/rebinds the active subscription.
3. Validate `ask_user` answers and `submit_plan` resume payloads before calling `session.respondToToolSuspension()`.
4. Persist Workbench metadata per thread. Native pending suspensions cannot be resumed safely after a desktop restart; restored stale cards are marked cancelled.
5. Keep the shared contracts as an explicit adapter boundary because AgentController is beta and the installed Mastra version is pinned.

## Backlog (do not forget)

- Workspace write/edit tools and full tool approval/audit history.
- External actions/connectors, notifications, and durable action receipts.
- Subagent/delegation support.
- Advanced memory controls and semantic recall UI.
- Concurrent runs across multiple conversations.
- Drag-reorder queued follow-ups; edit/resend/regenerate polish beyond retry.
- Thumbs up/down feedback, read aloud, export, transcript search/virtualization.
- Per-response token/cost details, richer evidence/surfaces, voice, image, and multimodal input.

