# PROTEUS Companion UI Revamp Plan

Status: implementation in progress; shell and interaction surfaces are implemented, with final brand asset selection pending.

## Goal

Give the main Companion more space and restore the calm composition of the
prototype while retaining the production chat, Mastra work-state, and
human-in-the-loop behavior.

The finished desktop UI must provide:

- compact, searchable conversation history without a permanent session column;
- a Workbench that appears only for real structured work and visually matches
  the prototype;
- an icon-first main sidebar that does not resize the Companion when expanded;
- one coherent PROTEUS brand mark for the interface and packaged application;
- reliable keyboard, responsive, and Windows display-scaling behavior.

## Visual source of truth

`app/index.html` and `app/styles.css` are the single visual source of truth.
Production-only controls may extend the prototype, but must use its typography,
spacing, radii, borders, surfaces, colors, shadows, and quiet interaction tone.
Do not create a parallel visual language in `desktop/src/mainview/index.css`.

Human-in-the-loop approvals remain in the main chat. The Workbench may summarize
that attention is required and link to the approval card, but must not move the
approval controls out of the transcript.

## Scope boundaries

In scope:

- Companion shell, title bar, conversation history, Workbench, main sidebar,
  responsive behavior, icons, and brand assets;
- small UI-facing contract/RPC adjustments required for rename-by-thread and a
  durable Workbench goal;
- accessibility, behavior tests, packaged-app verification, and visual QA.

Out of scope:

- redesigning the message bubble system or the main liquid Orb;
- changing OpenRouter, Mastra model behavior, or the text-generation pipeline;
- showing Evidence or Surface groups before real typed runtime data exists;
- allowing create, rename, or delete while a Mastra run is active;
- implementing concurrent runs, Projects, or long-term Memory.

Evidence and generated-surface runtime wiring stays in the backlog. Empty or
fabricated placeholders must never be shown.

## 1. Replace the permanent conversation column

Remove the 230px `ThreadList` column and return the Companion shell to the
prototype's stage + optional Workbench composition.

### Title and popover

- Make the active conversation title a button with a small downward chevron.
- Remove the standalone Rename button.
- Mark the title control as a non-drag region inside the draggable title bar.
- Anchor a 340-380px conversation popover to the title.
- Close it on selection, Escape, outside click, or loss of the owning view.
- Restore focus to the title trigger when it closes.

The popover contains:

- a search field;
- a New Chat action;
- conversations grouped into Today, Previous 7 days, and Older;
- one-line truncated titles, activity/attention dots, and relative timestamps;
- hover/focus actions for Rename and Delete;
- clear empty and no-search-results states.

### Rename and delete

- Rename any conversation inline in its row.
- Enter saves; Escape cancels; blur follows an explicitly defined safe policy.
- Double-clicking the active title is an additional rename shortcut.
- Replace `window.prompt` with the inline editor.
- Adjust the rename RPC to accept `{ threadId, title }` instead of operating only
  on the selected thread.
- Delete opens a PROTEUS-styled modal containing the conversation name, an
  irreversible-action warning, Cancel, and destructive Delete.
- Escape and the safe initial focus cancel the modal; focus is trapped while it
  is open and restored afterward.

During an active run, browsing and selecting other conversations remains
available. New Chat, Rename, and Delete are disabled with the explanation
"Available when the current response finishes."

## 2. Reclaim and stabilize the Companion stage

- Remove the production-only session column from `text-chat-layout`.
- Center the transcript, model context row, and composer in a shared 760-820px
  reading column.
- Keep user messages right-aligned and retain the existing bounded bubble width.
- Remove the Workbench text toolbar from inside the stage.
- Move the Workbench toggle to the title bar as a compact Lucide panel icon.
- Show an attention badge on the toggle only when action is required.
- Preserve the smart-scroll, Latest control, composer, main liquid Orb, and
  human-in-the-loop transcript behavior.

## 3. Make Workbench an adaptive visible-work surface

### Open and close lifecycle

- Start collapsed at rest; do not render a zero-token or empty Session card.
- Auto-open only when structured work exists: active tools, plan/tasks, queued
  follow-ups, pending interaction, or future real evidence/surface data.
- Ordinary text replies do not open it.
- After structured work completes, keep it open in the completed state for
  review.
- Collapse when the user closes it, changes conversations, or starts a new
  ordinary chat turn.
- Preserve a manual title-bar toggle so completed work can be reopened.

### Prototype hierarchy

Render one cohesive `workbench-live` card at an adaptive 340-420px width. Its
header is:

- `CURRENT WORK` caption;
- concise goal/title;
- status pill: Active, Needs you, Interrupted, Error, or Done.

Derive the goal locally from the initiating user message, cleanly truncated to
one or two lines. Replace it with the submitted plan summary when Mastra supplies
one. Do not make a separate model request. Persist the UI-facing goal with the
thread's Workbench state when required for completed-state review.

Adaptive group order:

1. Attention required, only while blocked; link back to the main-chat card.
2. Plan and task progress.
3. Current activity and tools.
4. Evidence and generated surface, only after real typed data exists.
5. Queued follow-ups and cleared-by-steering recovery.
6. Session details, collapsed at the bottom and only when total tokens are above
   zero.

Use the prototype's nested group styling, task indicators, status treatments,
and restrained animation. Do not render loose floating cards on the page.

### Responsive behavior

- On wide windows, Workbench occupies a true second grid column and does not
  cover the transcript.
- Animate its column opening/closing without remounting chat or the liquid Orb.
- When the stage cannot retain its reading width plus the Workbench, present it
  as a right-side overlay drawer using the same card design.
- Escape, close button, and outside click close the drawer without losing state.

## 4. Revamp the main sidebar into an icon-first rail

- Default to the prototype's 68px collapsed width.
- Expand to the prototype's 240px width as an overlay; never reflow or shrink the
  Companion.
- Open by explicit toggle, not hover. Close on navigation, Escape, or outside
  click.
- Remove Presence/status from the footer entirely.
- Keep the existing `PROTEUS` uppercase wordmark and letter spacing in expanded
  mode.
- Add accessible tooltips and labels for every collapsed icon.

Order:

1. PROTEUS brand/home.
2. Distinct New Chat quick action.
3. Companion.
4. Projects.
5. Memory.
6. Flexible space.
7. Settings.

Use a quiet 42px rounded-square active state based on the prototype's white card,
hairline border, and ink icon. In expanded mode, extend the same state behind the
label.

## 5. Adopt a library-backed icon system

- Add `lucide-react` and remove the general-purpose inline SVG icon map.
- Import icons individually so the production bundle can tree-shake unused
  glyphs.
- Keep a small typed PROTEUS icon wrapper that normalizes size, stroke width,
  alignment, and accessibility defaults.
- Use Lucide for navigation, title bar, popover, Workbench, modal, message
  actions, and settings controls.
- Keep the custom PROTEUS brand mark outside the icon library.

## 6. Create the new PROTEUS brand and packaged app icon

Visual direction:

- distinctive liquid-orb silhouette with a subtle negative-space `P` or orbital
  cut;
- mint-to-lavender PROTEUS palette;
- recognizable at 16px without becoming a generic gradient circle;
- in-app mark without a container tile;
- Windows executable/taskbar mark on a deep-ink rounded-square tile;
- static at rest, with only a restrained hover sheen/scale in the sidebar;
- main liquid Orb remains the only ambient animated brand element.

Approval checkpoint:

1. Produce three closely related mark candidates.
2. Show each at presentation size and at 16px/32px on light and dark grounds.
3. Pause for user selection before integration.

After approval:

- create a clean master SVG and derived transparent PNG sizes;
- generate a multi-resolution Windows ICO including 16, 24, 32, 48, 64, 128,
  and 256px sources;
- replace the in-app brand glyph and favicon;
- wire the packaged Electrobun application icon using the supported build
  configuration;
- verify the icon in the executable, taskbar, window switcher, and installed app
  surfaces.

## 7. Accessibility and interaction requirements

- Full keyboard navigation for the title trigger, popover rows, inline rename,
  modal, sidebar overlay, Workbench toggle, and drawer.
- Visible focus states derived from the prototype tokens.
- Correct `aria-expanded`, `aria-controls`, dialog semantics, active-page state,
  labels, and status announcements.
- No hover-only action: row actions must also appear on keyboard focus.
- Respect reduced motion for panel, popover, and brand transitions.
- Preserve draggable title-bar behavior by explicitly marking all controls as
  non-drag regions.

## 8. Implementation sequence

1. Extract small pure UI helpers for conversation grouping/search and Workbench
   open-state policy; add behavior tests.
2. Refactor the Companion shell and title bar; implement the conversation
   popover, inline rename, and deletion modal.
3. Update rename-by-thread RPC/contracts and retain active-run safety guards.
4. Implement the icon-first sidebar overlay and migrate interface icons to
   Lucide.
5. Rebuild Workbench with its goal/status header, adaptive groups, lifecycle,
   title-bar control, and responsive drawer.
6. Run the three-candidate brand checkpoint; after approval, generate and wire
   the complete icon asset set.
7. Finish keyboard/focus/reduced-motion work and responsive tuning.
8. Run automated verification, packaged-app checks, visual QA, Graphify update,
   and a final implementation review.

## 9. Acceptance criteria

### Conversations

- No permanent conversation card or third column remains.
- The title popover supports search, grouping, selection, creation, inline rename,
  status display, and modal deletion.
- Active-run restrictions are understandable and do not prevent browsing.
- Popover and modal have complete keyboard and focus behavior.

### Companion and sidebar

- Transcript/composer remain centered and readable with or without Workbench.
- Sidebar is a 68px icon rail by default and overlays at 240px without moving the
  Companion.
- Presence/status footer is gone.
- Lucide icons are visually consistent and the custom brand mark remains crisp at
  all required sizes.

### Workbench

- Closed for ordinary idle/text chat; auto-opens for real structured work.
- Matches the prototype's single-card header/group hierarchy.
- HIL controls remain in chat; Workbench attention links reach them.
- Completed work stays reviewable.
- Token details are absent at zero and collapsed otherwise.
- Unsupported Evidence/Surface content is never fabricated.

### QA matrix

- Primary: 1440x900 and 1920x1080.
- Minimum: 1024x700.
- Windows display scaling: 100%, 125%, and 150%.
- Validate both Workbench column and narrow overlay-drawer modes.
- Validate long titles, many conversations, empty search, active run, waiting HIL,
  completed work, interrupted work, offline/key-missing state, and reduced motion.
- Run `bun run typecheck`, `bun test`, and `bun run build` from `desktop/`.
- Launch the packaged app and verify taskbar-safe height and all icon surfaces.
- Run `graphify update .` after code or documentation changes.

## Backlog retained

- Real typed Evidence and generated Surface events from Mastra/runtime.
- Thread creation, rename, or deletion while another thread is running.
- Persistent/pinnable sidebar expansion.
- Advanced conversation organization such as favorites, folders, or bulk actions.
- Additional Workbench surfaces beyond the prototype's current data contract.
