---
status: proposed
---

# Any answer can arrive as UI, in the Island

Proteus answers with interface, not only prose. When a question is better answered as a list of things to act on, a comparison, a number or a trend, the Island (ADR 0001) grows into the answer the way a dynamic notch does: a header with the orb and the question, a one-line headline, then blocks streamed in one after another: a "Needs you" list whose rows carry their own actions, a stat, a table with the pick marked, a bar chart, the sources, follow-up suggestions. When the person presses Done (or asks a follow-up), the answer settles into the thread as a card, rendered from the same blocks, so the record and the live answer never diverge. Prose answers stay prose; asks (approvals, questions, plans) keep their own Island card.

The blocks come from a fixed catalog in the design system, and the agent can only describe answers with it: `headline`, `text`, `list` (rows: title, one line, an optional mark, time or one action), `stats`, `table` (2–6 columns, one pick), `bars`, `sources`, `suggest`. An answer is a flat, ordered list of blocks with text-only data, which is what lets it stream and render progressively. Actions are named intents (`approve`, `reply`, `open`, …) that the host routes through its own policy, so an Approve in an answer is the same approval gate as an Island ask: nothing that writes runs without it.

The prototype shows it end to end: https://claude.ai/artifact/74AkzzkwVeB3CE3765QBfF (the three home prompts, any typed question, and follow-up chips). The catalog and its Island and thread themes are the Answer component of the design system: https://claude.ai/artifact/LzFK4X4p6i68rg66ANb1yE.

## How it runs on our stack

- The agent answers through one tool, `show_answer`, whose input schema (zod) is the catalog. Mastra streams the tool's input as it is generated; `native-stream-projection` extends its existing tool-call projection to keep the partially parsed blocks and project them into the snapshot, and the React Island renders whatever blocks are complete. The answer is stored with the thread like any tool call, so history, memory and reloads need nothing new.
- The renderer is ours: a registry from block type to a React component styled by the design system. Unknown block types, extra fields and oversize content (more than 12 rows, 6 columns or 200 cells) are rejected by the schema, not drawn.
- An intent from a row becomes a runtime request with the conversation, answer and row ids. The runtime maps it to a tool through the existing allowlist and approval policy and records the outcome on the row, which the snapshot carries back as "Approved", "Drafted" or "Opened".
- Choosing between prose and an answer is the model's job, guided by the agent instructions ("use `show_answer` when the reply is a set of things to act on, a comparison, numbers or a trend"); there is no separate routing model.

## Considered options

- **CopilotKit over AG-UI (`@ag-ui/mastra`).** It supports Mastra and brings generative UI, shared state and interrupts. Rejected for now: it adds a second runtime and state layer beside Mastra, which owns runs, suspensions and history here (HANDOFF: no second renderer-side run state machine), and its server route assumes a web host rather than Electrobun's RPC boundary.
- **Forking OpenIntelligentUI.** A reference Next.js app with a Python LangGraph agent; adopting it means replacing Mastra and the desktop runtime. We take its ideas instead: a per-turn choice between text, native components and custom UI, and a validated host bridge.
- **Model-written HTML, CSS and JS in a sandboxed iframe** (OpenIntelligentUI's custom UI). Deferred, not rejected: it is the right tool for one-off calculators and simulations, but it needs an isolated origin, a CSP for generated code, bundled libraries (our CSP forbids CDNs) and a bridge we trust. It would arrive later as one more catalog block, `sandbox`, behind the same intents.
- **Google's A2UI as the wire format.** Its model matches ours (a client-owned catalog, a flat streamed component list, data separate from layout). We keep our schema A2UI-shaped so we can adopt the v1.0 format once it is final, without depending on a release candidate now.
- **Answers in the thread only.** Rejected: the Island is where Proteus talks to you (ADR 0001); reading and acting on the answer there, then keeping it in the thread, is the dynamic-notch behaviour we want.

## Consequences

- The Island has a third body besides input and ask: the answer. It grows upward on the same curve, keeps its width, shows `Speaking` while blocks stream and `Answer` when done, and its end button becomes Done. An open Island is near-opaque glass, so copy behind it never competes.
- Follow-ups in an idle conversation are answered in place: the open answer settles into the thread, then the next one opens. Requests that need a run with approvals (editing files, drafting with a question) still start their own conversation.
- The catalog is a versioned contract shared by the agent's schema, the renderer and the design system; adding a block means all three.
- Every answer ends with its sources, and every number, row and cell is plain text from the tool input: no markup, no links except through `open`.
- Accessibility: tables use table roles, charts carry a text summary (`aria-label` with the values), row actions name their row, and streaming announces through the Island's existing live region.
