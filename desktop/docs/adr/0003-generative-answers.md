---
status: proposed
---

# Any answer can arrive as UI, in the Island

Proteus answers with interface, not only prose. When a question is better answered as a list of things to act on, a comparison, a plan, a number or a trend, the Island (ADR 0001) grows into the answer the way a dynamic notch does: a header with the orb and the question, a one-line headline, then blocks streamed in one after another. When the person presses Done (or asks a follow-up), the answer settles into the thread as a card, rendered from the same blocks, so the record and the live answer never diverge. Prose answers stay prose; asks (approvals, questions, plans) keep their own Island card.

The agent can only describe answers with a fixed catalog from the design system, and everything below is a contract shared by the agent's schema, the renderer and the design system: a rule here is enforced by the schema or the renderer, never left to the model's judgement.

The prototype shows it end to end: https://claude.ai/artifact/74AkzzkwVeB3CE3765QBfF (home prompts, typed questions such as "What does my day look like?", "Is the launch on track?", "Fix the beta date in the plan", and follow-up chips). Markup and visuals are the Answer and Answer blocks components of the design system: https://claude.ai/artifact/LzFK4X4p6i68rg66ANb1yE.

## The catalog (v2)

An answer is `{ v: 2, title, blocks }`: a flat, ordered list of blocks with text-only data. No nesting, no layout containers, no free-form styling.

| Block | What it is for | Limits |
|---|---|---|
| `headline` | The answer, in one sentence | Exactly one, first; ≤ 140 characters |
| `text` | Context the headline needs | ≤ 2 sentences, ≤ 320 characters |
| `stats` | Two or three numbers that matter | 1–3 items; optional delta (signed text plus up/down/flat) and sparkline (2–12 tenths, only with a delta) |
| `list` | Things to act on or that were handled | 1–12 rows; each row one optional action |
| `timeline` | A day or a sequence | 1–10 rows in time order; at most one "now"; rows as list rows |
| `progress` | How far along parts of a whole are | 1–6 meters; 0 ≤ now ≤ max; the value in words |
| `table` | A comparison | 2–6 columns, 1–12 rows, every row as wide as the header; at most one pick |
| `bars` | A trend or distribution | 2–12 bars in tenths; at most one highlighted; a text summary of every value |
| `choice` | A decision the person makes | 2–4 options, one Confirm |
| `diff` | One proposed edit to one file | 1–12 lines; Approve and Not now |
| `quote` | The source's own words | ≤ 280 characters, always with where it came from |
| `sources` | Where the answer came from | 1–6 |
| `suggest` | The next questions | 1–3 |

Heights and widths travel as tenths and render as classes, so the data stays text and no value from the model reaches a style.

## Composition rules

- `headline` first; `sources` then `suggest` last; at most 10 blocks.
- At most one primary action, one `choice` and one `diff` in an answer.
- Every answer that states a fact has `sources`. A chart, meter or sparkline never stands alone: a label, value or sentence says what it shows.
- An answer that breaks a composition rule is rejected as a whole (see Validation); a block that breaks its own limits is replaced, not the answer.

## Content rules

- Plain text everywhere: no markup, no links, no HTML or Markdown in any field. Opening anything goes through the `open` intent.
- Numbers as people read them ("1,284", "3h 30m", "Tue 20 Oct"); deltas carry their sign ("+38%", "−0.3 pts").
- Colour is never the only signal: deltas have signs and arrows, meters that are behind say "behind", diff lines have `−` and `+` and are announced as removed or added, needs-you rows have the warn dot and their own words.
- The headline answers; it never restates the question or announces the answer ("Here is…").

## Intents and safety

Every action in an answer is a named intent from a closed set, never a tool call:

| Intent | What the host does | Gate |
|---|---|---|
| `open` | Opens a file, event or page the answer cites | None: read only |
| `reply` | Drafts a message | Nothing is sent until the person presses Send |
| `approve` | Runs the write the row or diff proposes | The same approval gate as an Island ask |
| `choose` | Sends the picked option as the person's reply | None: it is their answer, and starts no write |
| `skip` | Records "not now" on the row or diff | None |

The host maps an intent to a tool through the existing allowlist and approval policy, with the conversation, answer and block or row ids; anything not on the allowlist is refused. An intent runs at most once per row or block: the outcome ("Approved", "Drafted", "Opened", "Chosen · …", "Not now · unchanged") is recorded on it and carried by the snapshot, so a reload or a second click does not repeat it. A `diff` shows exactly the change Approve will make; if the file has changed since the answer was drawn, Approve fails with the runtime's message and nothing is written.

## Streaming and validation

- The tool's input is parsed as it streams. A block renders once it is complete and valid; rows of a list, timeline, progress or table render one at a time as they complete. Three breathing dots hold the place of the next block until the tool call ends.
- Each block is validated against its limits when it completes. A block that fails renders as one fallback line ("One part of this answer couldn't be shown.") and the rest of the answer still shows; a half-drawn block is never shown.
- The complete answer is validated against the composition rules when the tool call ends. If it fails, the model gets the schema error and one retry; if the retry fails too, it answers in prose. The person never sees a rejected answer.
- Unknown block types and fields are rejected, and so are answers over the size caps (12 rows or options per block, 6 columns, 200 table cells, 10 blocks).

## Accessibility

- Tables use table roles; bars are an image whose label lists every value; meters use `role="meter"` with the value in words; a timeline is a list; a choice is a radio group with one tab stop (arrows move and pick, Confirm is the next tab stop); a diff is a group named after the file, with each changed line announced as removed or added.
- Every action names its row ("Approve: Edit docs/plan.md"). Focus never moves on its own while an answer streams.
- Streaming is announced once through the Island's live region ("Answering", then "Answer ready"), not per block.

## Motion and theming

One markup on two surfaces: the blocks read their colours from variables, so they are dark glass in the Island and light in the thread card, in Day and Night. Blocks and rows arrive with the standard rise, bars and meters grow from their baseline, the headline is written in with the ink sweep (ADR 0002). Reduced motion shows each block and row at once. Answers add no colours: status uses the existing attention, success and error tokens, and only for what they already mean.

## Versioning and conformance

- The catalog is versioned (`v`). Adding a block or an optional field is a minor change; changing a limit, a field's meaning or an intent is a new version. The renderer draws every version it knows and treats an unknown one as invalid.
- A change to the catalog lands in one change set across the schema, the renderer, the design system's Answer components and this ADR.
- Required tests: a schema test for every limit and composition rule (accepted at the limit, rejected past it); a renderer test per block for its markup and roles; the fallback for an invalid block; each intent's routing and its once-only outcome; keyboard use of choice and diff; a visual check of every block in the Island and the thread card, in Day and Night.

## How it runs on our stack

- The agent answers through one tool, `show_answer`, whose input schema (zod) is the catalog. Mastra streams the tool's input as it is generated; `native-stream-projection` extends its existing tool-call projection to keep the partially parsed blocks and project them into the snapshot, and the React Island renders whatever blocks are complete. The answer is stored with the thread like any tool call, so history, memory and reloads need nothing new.
- The renderer is ours: a registry from block type to a React component styled by the design system.
- An intent from an answer becomes a runtime request; the runtime records the outcome on the row or block, which the snapshot carries back.
- Choosing between prose and an answer is the model's job, guided by the agent instructions ("use `show_answer` when the reply is a set of things to act on, a comparison, a plan, numbers or a trend; answer in prose otherwise"); there is no separate routing model.

## Considered options

- **CopilotKit over AG-UI (`@ag-ui/mastra`).** It supports Mastra and brings generative UI, shared state and interrupts. Rejected for now: it adds a second runtime and state layer beside Mastra, which owns runs, suspensions and history here (HANDOFF: no second renderer-side run state machine), and its server route assumes a web host rather than Electrobun's RPC boundary.
- **Forking OpenIntelligentUI.** A reference Next.js app with a Python LangGraph agent; adopting it means replacing Mastra and the desktop runtime. We take its ideas instead: a per-turn choice between text, native components and custom UI, and a validated host bridge.
- **Model-written HTML, CSS and JS in a sandboxed iframe** (OpenIntelligentUI's custom UI). Deferred, not rejected: it is the right tool for one-off calculators and simulations, but it needs an isolated origin, a CSP for generated code, bundled libraries (our CSP forbids CDNs) and a bridge we trust. It would arrive later as one more catalog block, `sandbox`, behind the same intents.
- **Nested layout (rows, columns, cards inside cards).** Rejected: it lets the model design pages, which breaks the one calm column of ADR 0001, makes streaming order ambiguous and makes limits hard to enforce. A flat list with a fixed order reads the same in the Island and the thread.
- **Actions as tool calls in the answer.** Rejected: the model could then name any tool from an answer. A closed intent set keeps the allowlist and approval policy the only path to a write.
- **Free inputs (text fields, forms) in answers.** Not now: the Island's input is where the person types, and a `choice` covers the decisions answers need. A form block would need its own validation and privacy rules.
- **Google's A2UI as the wire format.** Its model matches ours (a client-owned catalog, a flat streamed component list, data separate from layout). We keep our schema A2UI-shaped so we can adopt the v1.0 format once it is final, without depending on a release candidate now.
- **Answers in the thread only.** Rejected: the Island is where Proteus talks to you (ADR 0001); reading and acting on the answer there, then keeping it in the thread, is the dynamic-notch behaviour we want.

## Consequences

- The Island has a third body besides input and ask: the answer. It grows upward on the same curve, keeps its width, shows `Speaking` while blocks stream and `Answer` when done, and its end button becomes Done. An open Island is near-opaque glass, so copy behind it never competes.
- Follow-ups in an idle conversation are answered in place: the open answer settles into the thread, then the next one opens. Requests that need a run with approvals (editing several files, drafting with a question) still start their own conversation; a single proposed edit can be a `diff` in an answer.
- Kept answers stay live in the thread: their actions keep their outcome and an unconfirmed choice can still be confirmed there.
- A `diff` or an `approve` row is a second place an approval can happen besides the Island ask, so both must go through the same gate and record the same outcome.
