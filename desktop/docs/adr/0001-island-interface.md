---
status: accepted
---

# The Island is where you talk to Proteus and where it asks you

The desktop UI moves to direction C, "Island": a light window with a translucent sidebar pane and one 720px conversation column, with a single dark capsule pinned to the foot of the stage. The Island is the composer, the live run status and the only place Proteus asks for approval, answers or plan sign-off. The orb lives in it once a conversation starts. We chose it over two other directions because it puts "nothing moves without you" in one fixed, unmissable place, and lets the thread stay a plain record of what happened.

The design system that defines it (tokens for Day and Night, Plus Jakarta Sans and JetBrains Mono, the Island, Sidebar, StepList and the rest) is the Proteus design system artifact: https://claude.ai/artifact/LzFK4X4p6i68rg66ANb1yE. The playable prototype of the whole app, Tide included, is https://claude.ai/artifact/74AkzzkwVeB3CE3765QBfF; the direction was chosen from the "C · Island" board in https://claude.ai/artifact/2WafpTRXhRaTWrj4rNvWQJ. Neither is implemented in `desktop/src/mainview` yet.

## Material: Tide (liquid glass)

What floats over content or changes shape is made of Tide, our liquid glass: the Island, menus and pickers, modals, toasts and the segmented thumb. Glass is translucent over a blurred, saturated backdrop with a hairline edge and a lit top rim, and can refract what is behind it through an SVG lens filter (`#proteus-lens`). The Island is smoked glass that floats over the thread, so the conversation visibly passes under it, and the orb's state colour glows through it as a faint caustic. A quiet ambient field of three far, blurred orb echoes sits on the canvas so the glass has something to bend. The sidebar is a Tide pane: translucent over the ambient field with the glass edge and lit rim but no backdrop blur, since it never moves and the field behind it is already soft; New chat and the current conversation are small glass beads in it, not an ink button. Everything else (cards, tiles, the thread) stays opaque: glass marks the things that float or transform, not decoration.

We chose this over keeping the Island a solid ink capsule because the glass makes the Island read as one layer above the work rather than a footer, and it lets the orb's colour reach beyond its 44px without adding UI colour.

## Considered options

- **A · Still**: one light column, no sidebar, the orb inside the composer, approvals as inline cards. Rejected: hiding history behind an icon made switching conversations slow, and inline cards scroll away from the person mid-run.
- **B · Lumen**: dark, a permanent presence panel on the right holding the orb, live steps and approvals. Rejected: a second column costs a third of the window on every screen, and it is a lighter version of the context pane we are removing.
- **C · Island** (chosen).

## Consequences

- Asks never render in the thread. `InteractionCard` (tool approval, `ask_user`, `submit_plan`, recovery) becomes Island content; the thread records the outcome as one resolved line ("Approved · Edit docs/plan.md"). Only one ask shows at a time; others queue.
- The context pane and its tabs go. The live step list moves into the thread; files, search, memory and details move to their own destinations or the conversation menu.
- The 68px nav rail becomes the sidebar pane; Projects, Memory and Settings sit at its foot. It carries no brand or orb: the orb appears only on the stage and in the Island, and the window title names the app.
- The fonts must be bundled with the app: the desktop CSP allows only `font-src 'self'`.
- Glass costs GPU time: backdrop blur and the SVG lens run on every frame the content behind them changes. Keep at most a few glass surfaces on screen (the Island plus one overlay) and never stack glass on glass. The sidebar pane is translucency only, so it does not count against this.
- The lens depends on `backdrop-filter: url()`, which Chromium (WebView2, our Windows target) supports and other engines may not; there the glass falls back to blur only. The Island's glass is 86% opaque so its text keeps contrast with or without blur.
- `prefers-reduced-transparency` turns every glass surface solid and removes the ambient field and caustic.
