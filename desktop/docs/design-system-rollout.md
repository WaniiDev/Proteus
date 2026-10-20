# Design system rollout

How the renderer (`src/mainview`) moves to the Proteus design system: https://claude.ai/artifact/LzFK4X4p6i68rg66ANb1yE. The system's **Implementing Proteus** section is the contract (what to vendor, what to port, the rules and the "done means" checklist). This file is the plan for this app: which files change in which order, where each new component gets its data, and which tests will move. The decisions behind it are ADR 0001 (Island interface), ADR 0002 (motion) and ADR 0003 (generative answers). The playable reference is https://claude.ai/artifact/74AkzzkwVeB3CE3765QBfF.

## Where the app starts from

- One light theme. Tokens live in `proteus.css` (`:root`, an older "editorial" palette with EB Garamond and Inter). No `@font-face` exists, so both fonts fall back to system fonts today.
- Styles are spread across `index.css` (about 1,230 lines), `proteus.css` and `sidebar.css`, all bundled by Vite from `main.tsx`. Class names mix flat kebab-case and BEM.
- The CSP (`index.html`) allows only `font-src 'self' data:` and `style-src 'self' 'unsafe-inline'`. Electrobun copies only `dist/index.html` and `dist/assets`, so fonts and SVGs must be imported (or placed under `public/assets/`) so they land in `dist/assets`.
- The orb (`orb/orb3d.ts`, `orb-spec.ts`, `orb-motion.ts`, `orb-state.ts`) already matches the system's orb and stays. `OrbState` has 15 states; `focusing` is not in it yet.
- All UI data comes from one `RuntimeSnapshot` (`shared/contracts.ts`), held in `App.tsx` state and fed by `lib/runtime-snapshot-transport.ts`. No store library.

## Phase 0: foundations (no visible redesign yet)

1. Vendor the system into `src/mainview/ds/`: `tokens.css`, `bundle.css`, `fonts/*.woff2`, plus a `VERSION` comment with the system's version id. Import `ds/tokens.css` and `ds/bundle.css` first in `main.tsx`, before `index.css`.
2. Add `<html data-theme>`, driven by `prefers-color-scheme` until the person chooses, and persisted. Update the `theme-color` meta to the Day and Night canvas.
3. Add the font licences (SIL OFL 1.1) and the LobeHub Icons MIT notice to the app's third-party notices.
4. Add `ProviderMark` with the LobeHub mono paths; replace `lib/provider-assets.ts` and `assets/providers/*.svg`.
5. Port `scrollbars` to `useScrollbars()` at the root; delete the old `--scrollbar-thumb*` rules in `proteus.css` and every `scrollbar-width: thin` in `index.css`. Rewrite `scrollbar-style.test.ts` to assert against `ds/bundle.css`.
6. Add the lint rules from **Implementing Proteus** (colour literals, `z-index` numbers, `scrollbar-*`) for `src/mainview/**/*.css` and `*.tsx` outside `ds/`.

Done when the app looks the same but runs on the new fonts, both themes switch without unstyled flashes, and `bun run test` and `bun run typecheck` show no new failures.

## Phase 1: shell and destinations

| Today | Becomes | System component |
|---|---|---|
| `App.tsx` `.ambient`, `.app-shell` | Ambient field, stage, the Tide lens mounted once | Tide |
| `components/Sidebar.tsx` (+ `sidebar.css`) | Sidebar pane: glass New chat bead, Pinned/Today/Earlier session rows with the actions menu, destinations at the foot, no brand or orb | Sidebar, Menu |
| `views/SettingsView.tsx`, `ProviderSettings.tsx` | Page + List; providers through the Select with one provider shown | List, Select, Field, Switch |
| `MemorySettingsPanel.tsx` / `MemorySettingsSurface.tsx` | Page + List | List |
| `views/ProjectsView.tsx`, `DeleteThreadModal.tsx` | Page + List; Modal | List, Modal, EmptyState |
| `PageHeader.tsx` | `.page-head` | List |

Data:
- **Sessions** come from `snapshot.threads`.
  - Rename and Delete keep `threads.rename` and `threads.delete`.
  - Copy transcript is client-side, from `snapshot.messages`.
  - **Pin to top needs runtime support, and gets it:** a `pinned` field (with `pinnedAt`) on the thread summary and a `threads.pin` request, added in Phase 1 before the sidebar's Pinned group.
- **Providers** come from `snapshot.providers`, using the existing `providers.select` and connect mutations.

Tests that read CSS text and will need rewriting: `components/Sidebar.test.tsx`, `settings-ui.test.ts`, `memory-settings-ui.test.ts`, `supporting-layout.test.ts`.

## Phase 2: the Island

| Today | Becomes |
|---|---|
| `components/Composer.tsx` | Island input body, project chip and split model chip. The pickers rise above the Island, and the EffortSlider is driven by the selected model's `reasoningOptions`. |
| `components/InteractionCard.tsx`, `InteractionPrimitives.tsx` | Island ask bodies (approval, question, plan, recovery), one at a time; the thread records one resolved line |
| `PersistentOrbSurface.tsx`, `OrbPresence.tsx` | Hero orb on an empty conversation; 44px orb in the Island afterwards (`fly` budget `dur-fly`) |
| `orb/orb-spec.ts`, `shared/contracts.ts` | Add `focusing` to `ORB_STATES` and `OrbState`, played as a moment when thinking moves to the model's top level, with the surge (ADR 0002) |

Note: the Settings Models tab shows an `EffortSlider` without `onTopLevel`. No orb is on screen in Settings (the orb lives in the Companion view and its `useFocusingMoment`), so there is no handle to play the focusing moment on; the chips picker in the Island wires it.

Data:
- **Asks:** from `snapshot.interactions`, answered through `chat.interaction.respond`, `chat.interaction.dismiss` and `chat.tool-approval.respond` (with its fingerprint).
- **Models:** from `snapshot.models`.
- **Selection:** `selectedProviderId`, `selectedModelId` and `selectedReasoningEffort`, changed with `models.select` and `models.reasoning.select`.
- **Thinking levels:** the runtime's efforts (`none` … `ultra`), all named in EffortSlider.

Tests that move: `Composer.test.tsx`, `lib/composer-ui.test.ts`, `InteractionPrimitives.test.tsx`, `orb/orb-spec.test.ts` (16 states).

## Phase 3: the thread

| Today | Becomes |
|---|---|
| `views/Companion.tsx` thread, `AssistantTurn.tsx`, `MarkdownCode.tsx` | The 720px thread: bubble, reply with the ink reveal, resolved lines |
| `ToolTimeline.tsx` | StepList |
| `MessageActions.tsx`, `QueuedMessageBubble.tsx`, `SourcePill.tsx`, `WebSearchedSources.tsx` | Message actions and sources in system classes |
| `ContextPane.tsx` | Removed (ADR 0001). Its files, search, skills and details move to destinations or the conversation menu. `context-panel-policy.test.ts` and `ContextPane.test.tsx` go with it. |

`ToolTimeline.test.tsx` asserts reduced-motion rules in `index.css` and moves to the system's reduced-motion block.

## Phase 4: generative answers

ADR 0003 is accepted. The work is:
- the `show_answer` tool and its zod schema (catalog v2);
- the projection of partial blocks in `native-stream-projection`;
- a block renderer registry;
- the intents route.

The prototype's `genBlockOk` and `genAnswerOk` are the reference for the schema's limits.

## Listed deviations from the prototype (Settings and Memory)

- **Appearance keeps System, Day and Night.** The prototype has Day and Night only. `implementation.md` follows `prefers-color-scheme`, so System stays as the default choice.
- **Developer has extras the prototype lacks** (the diagnostics log, copy and clear actions), because the runtime reports real events.
- **Memory is a destination of its own**, as in the prototype, not a Settings tab. Settings keeps four tabs. Edit stays beside Forget on a saved item (the prototype has Forget only).
- **Forgetting one item still confirms in a modal.** The prototype forgets at once and shows a "Forgotten" toast; it now uses `useToast()` (`ds/Toast`).
- **Model rows and the thinking slider use an app modifier for the disabled look** (`.list-row.model-row:disabled`, `.settings-effort.is-locked`), because the system has no `.list-row:disabled`. Upstream: add it to the List component.
- **"Use a device code" stays on a signed-out Codex row.** The prototype has Sign in only; the device flow has no other entry (it is otherwise offered only after a failed sign-in).
- **A stored key that was rejected offers "Remove saved key"**, and a Codex sign-in that is configured but unreachable keeps "Disconnect", so neither gets stuck.
- **Refresh lives at the foot of the Models list** ("Refresh models"); the prototype has no refresh.

## Listed deviations from the prototype (conversation, toasts)

- **Files, Search and Details are dialogs with no prototype counterpart.** The prototype has no screen for a conversation's files, search or details (the old context pane they came from is removed, ADR 0001). They are built from the system's Modal scrim, `.list` rows and `btn-ghost` back button; there is nothing to compare them with, so their parity pairs are marked "no proto".
- **Toasts are announced through one live region.** `components/ds/Toast.tsx` is `role="status"` only where no Island is mounted; with an Island mounted its text goes out through `useToastAnnouncement()` into the Island's own region, so a page never has two.
- **Upstream to DS:** a disabled menu item and its one-line reason (`.menu > button.is-disabled`, `.menu-reason`) and the fold of a removed sidebar row (`.session.is-leaving`) are app rules in `sidebar.css` because the system has neither.

## Listed deviations and follow-ups (final review)

- **WAN-529 "requests that need approvals start their own conversation" is not implemented (follow-up).** A follow-up that needs approvals is sent in the same conversation; the prototype starts a new one.
- **Queued-message Cancel is not wired.** It needs a runtime dequeue RPC; the queued bubble shows its state only.
- **A question ask has no Cancel.** The runtime cannot cancel `ask_user`; the prototype's Cancel has no counterpart.
- **Stop is hidden while an ask is open** (`motion.md`: the ask answers from its body). While an answer streams, Stop stays and Done takes its place once the run is over.
- **Skills moved to the project page.** The prototype has no Skills surface.
- **The orb follower rate stays at ADR 0002's `1 - e^(-9t)`.** Hero to dock gaps over about 640px therefore take up to about 770ms.
- **The warn chip says "Connect <provider>"** (README), not the issue's "Not connected".
- **The Settings thinking slider does not play the focusing moment.** No orb is on that page.
- **A new chat is not listed in the sidebar until its first message**, as in the prototype; the app creates the thread at New chat, the sidebar hides it while it is empty and idle.
- **The thread records one resolved line per approved tool**, not one per ask group ("Approved · Edit notes/launch-faq.md" twice, where the prototype says "Edit 2 files in notes/"). The snapshot carries tool parts, not ask groups. An approved tool that then failed reads "Approved · ... — failed".
- **A new-chat error uses the system's `.notice.error`** in a fixed corner wrapper (`.app-shell-notice`, tokens only).
- **A reply that drafts text settles the open answer into the thread**, puts the draft in the input, focuses it and shows a "Draft saved" toast.

## Each phase ships when

- Every screen it touched passes the system's **Done means** checklist (Day and Night against the card, keyboard, reduced motion, reduced transparency, more contrast, forced colours, copy, states covered by tests).
- The old CSS it replaced is deleted in the same change, not left beside the new classes.
- `bun run test` and `bun run typecheck` show no new failures. The typecheck has pre-existing errors; keep their count from growing.
