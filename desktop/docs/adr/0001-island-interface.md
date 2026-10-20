---
status: accepted
---

# The Island is where you talk to Proteus and where it asks you

The desktop UI moves to direction C, "Island": a light window with a translucent sidebar pane and one 720px conversation column, with a single dark capsule pinned to the foot of the stage. The Island is the composer, the live run status and the only place Proteus asks for approval, answers or plan sign-off. The orb lives in it once a conversation starts. We chose it over two other directions because it puts "nothing moves without you" in one fixed, unmissable place, and lets the thread stay a plain record of what happened.

The design system that defines it (tokens for Day and Night, Plus Jakarta Sans and JetBrains Mono, the Island, Sidebar, StepList and the rest) is the Proteus design system artifact: https://claude.ai/artifact/LzFK4X4p6i68rg66ANb1yE. The playable prototype of the whole app, Tide included, is https://claude.ai/artifact/74AkzzkwVeB3CE3765QBfF; the direction was chosen from the "C · Island" board in https://claude.ai/artifact/2WafpTRXhRaTWrj4rNvWQJ. Neither is implemented in `desktop/src/mainview` yet.

## Material: Tide (liquid glass)

What floats over content or changes shape is made of Tide, our liquid glass: the Island, menus and pickers, modals, toasts and the segmented thumb. Glass is translucent over a blurred, saturated backdrop with a hairline edge and a lit top rim, and can refract what is behind it through an SVG lens filter (`#proteus-lens`). The Island is smoked glass that floats over the thread, so the conversation visibly passes under it, and the orb's state colour glows through it as a faint caustic. A quiet ambient field of three far, blurred orb echoes sits on the canvas so the glass has something to bend. The sidebar is a Tide pane: translucent over the ambient field with the glass edge and lit rim but no backdrop blur, since it never moves and the field behind it is already soft; New chat and the current conversation are small glass beads in it, not an ink button. Everything else (cards, tiles, the thread) stays opaque: glass marks the things that float or transform, not decoration.

We chose this over keeping the Island a solid ink capsule because the glass makes the Island read as one layer above the work rather than a footer, and it lets the orb's colour reach beyond its 44px without adding UI colour.

## Destinations: Page and List

Projects, a project, Memory and Settings share the conversation's 720px column instead of a wider dashboard. Each is a **Page**: a 24px heading, one muted sentence and at most the page's own actions, then grouped **Lists** of 56px rows on one opaque surface. Forms live in the row they belong to: a provider's key field opens under that provider, the memory composer is the first row of its list, a model is a radio row with a check. Explanations that used to be notice banners become the heading's sentence or a footnote under a list, and the one destructive action is a single danger row at the foot. We chose this over the card grids and 32px heads these pages had, because the pages are visited rarely and briefly: one column and one row pattern makes them read as part of the same calm app as the thread, and nothing on them competes with the Island.

## Considered options

- **A · Still**: one light column, no sidebar, the orb inside the composer, approvals as inline cards. Rejected: hiding history behind an icon made switching conversations slow, and inline cards scroll away from the person mid-run.
- **B · Lumen**: dark, a permanent presence panel on the right holding the orb, live steps and approvals. Rejected: a second column costs a third of the window on every screen, and it is a lighter version of the context pane we are removing.
- **C · Island** (chosen).

## Consequences

- Asks never render in the thread. `InteractionCard` (tool approval, `ask_user`, `submit_plan`, recovery) becomes Island content; the thread records the outcome as one resolved line ("Approved · Edit docs/plan.md"). Only one ask shows at a time; others queue.
- The context pane and its tabs go. The live step list moves into the thread; files, search, memory and details move to their own destinations or the conversation menu.
- The 68px nav rail becomes the sidebar pane; Projects, Memory and Settings sit at its foot. It carries no brand or orb: the orb appears only on the stage and in the Island, and the window title names the app.
- The project and model under the Island are context chips, not a line of text: each is a pill with an icon and caret that opens a picker rising above the Island (never over the input). The project chip locks once a conversation starts; the model chip turns to a warning when its provider isn't connected and is disabled while an ask is open. Pickers are radio groups with arrow-key movement, open on the chosen option, close on Escape or a click outside, and return focus to their chip.
- The fonts must be bundled with the app: the desktop CSP allows only `font-src 'self'`.
- Settings, Memory and Projects screens are rebuilt on Page and List (design system `List` component and `heading` type style). Project search is dropped until people have enough projects to need it.
- Glass costs GPU time: backdrop blur and the SVG lens run on every frame the content behind them changes. Keep at most a few glass surfaces on screen (the Island plus one overlay) and never stack glass on glass. The sidebar pane is translucency only, so it does not count against this.
- The lens depends on `backdrop-filter: url()`, which Chromium (WebView2, our Windows target) supports and other engines may not; there the glass falls back to blur only. The Island's glass is 86% opaque so its text keeps contrast with or without blur.
- `prefers-reduced-transparency` turns every glass surface solid and removes the ambient field and caustic.
