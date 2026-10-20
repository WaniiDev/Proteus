---
status: accepted
---

# Motion is seamless and liquid: the orb keeps its motion, nothing around it cuts

The orb’s look and motion do not change with the Island redesign (ADR 0001). It stays the WebGL sphere in `orb3d.ts`, its fifteen states and rhythms in `orb-spec.ts`, its exponential state blend, and the frame-driven placement follower in `orb-motion.ts` (`1 − e^(−9t)`, no overshoot).

One addition, made deliberately and on request: a sixteenth state, `focusing` ("Max thinking. I'll take the time this needs."), a moment played when the person moves thinking to the model's top level. It uses the same shader with its own row of values (amp .24, speed .35, freq 2.10, scale .94: a slow, dense churn) and colours (`orb-focusing-a/b`, lavender into peach). Two lavender rings close in on the orb, it presses to .9, then releases with a `pulse()` and one peach ring at 1.1s, and it returns to the state it was showing at 2.2s. It is also the one orb moment with a stage-wide surge: in the first half the stage outside the orb blurs and dims toward the edges while light gathers into the orb and the stage eases to .97 toward it; in the second half the light blooms out, two shockwave rings cross the stage, the glass ripples and the stage springs back. The Island and any open picker stay sharp on top. This is the only exception to "don't animate size or position", kept to one person-caused beat, and none of it plays under reduced motion. It is a moment, not a steady state, so `deriveOrbSteadyState` is unchanged; the app adds it to `ORB_STATES` and `OrbState` when the thinking control ships.

Everything around the orb follows one rule: **no surface appears, disappears or moves without a transition, and nothing the eye is tracking jumps.** Concretely:

- **The Island keeps its width.** An ask grows it upward (body rows 0fr → 1fr over 520ms on a small-overshoot curve); its row of orb, words and button never moves.
- **Island contents cross-fade.** Input, status, ask kicker, send and Stop all stay mounted and are switched by `data-on`; the leaving one blurs out (160ms) while the next sharpens in (220ms). A changing status line alternates between two slots so old and new words overlap.
- **Views have an exit.** Changing what the stage shows is two beats: the current view fades up 4px over 160ms, then the next rises in over 360ms. The orb and the Island sit outside the view, so between an empty conversation and a conversation the orb flies and the Island stays.
- **Every overlay has an exit.** Menus, modals and toasts leave over 160ms with an ease-in, shorter than they arrived.
- **Replies are written in.** Each paragraph reveals with a diagonal ink sweep over 900ms instead of fading in as a block.
- **Selections glide.** Segmented controls use one sliding thumb; Day ↔ Night eases every colour together for one beat; the thread scrolls smoothly.
- **Pages switch in two beats too.** A destination's own switches (Settings tabs, Memory spaces) move the segmented thumb at once, then the shown content fades up over 160ms before the next rises in on a stagger.
- **Rows grow and fold.** A row that needs a form grows open below itself the way the Island grows (height only, 520ms, its own line still, content kept mounted so it can fold shut). A removed row fades and folds its height away over 220ms, so the rows below close the gap instead of jumping.
- **Scrollbars wake and sleep.** Our own scrollbar (a 4px ink pill in an 8px gutter, no track) is hidden at rest, shows while its area is hovered, focused or scrolling, and fades out in two steps (180ms at half strength, then gone). It appears in one step because `::-webkit-scrollbar` parts can't transition, and it is shown by a `data-scrollbar` mark rather than `:hover`, which Chromium does not repaint.
- **Springs only for what the person caused**; reduced motion resolves everything at once.

## Liquid transformations

When a Tide glass surface (ADR 0001) changes shape it moves like liquid for one beat, then settles still:

- **Lens ripple and sheen.** As the Island grows into a card or settles back, the lens displacement swells and relaxes over 700ms (what is behind the glass wobbles once, like disturbed water) while a soft band of light crosses the glass.
- **Surface tension.** Opening, the Island squashes about 1% and overshoots back before it settles.
- **Droplets.** Menus, pickers, modals and toasts bud out of what opened them as a small round drop, stretch just past full size and settle (420ms); closing, they shrink back into a drop at the trigger.
- **Wave.** Sending or approving sends one ring of the orb's colour across the Island glass.
- **Liquid thumb.** A segmented thumb moves leading edge first and pulls its trailing edge after it, stretching like a drop.
- **Caustic.** The orb's colour glowing through the Island blends with the orb's own state change, fades out as an ask opens and returns as the Island settles.

These ride on the choreography above and never replace it; they only happen when something transforms, never on a timer. The ambient field behind the glass drifts imperceptibly (3% over 40s) and is the only loop besides the orb's breath.

The tokens (`dur-exit`, `dur-enter`, `dur-reveal`, `dur-morph`, `dur-fly`, `dur-ink`, `dur-drop`, `dur-ripple`, `ease-*`, `stagger`, the `glass` family) and the full choreography live in the design system’s motion section.

## Considered options

- **Restyle the orb** for the new look (a CSS "liquid" body with wobble and fewer states). Rejected: the orb is the product’s identity and its states are runtime contract (`deriveOrbSteadyState`, `recoveryGate`).
- **Morph the Island’s width** between a capsule and a narrower card. Tried and rejected: the width change reflowed the status text and moved the orb and Stop button mid-animation, which read as a jump. Growing in height only keeps the anchor still.
- **Mount and unmount Island variants** (conditional rendering with an enter animation). Rejected: the leaving content vanished in one frame, so every change looked like a swap. Keeping variants mounted costs a few hidden nodes and buys a true cross-fade.
- **Fixed-duration FLIP for the orb flight** in the app, as the prototype does. Rejected for the app: the Island’s anchor can move while content above it changes, and a fixed tween aimed at a moving target lands wrong. The follower re-measures every frame; the prototype’s 640ms `dur-fly` is the budget the follower must settle within.
- **A WebGL glass shader for the UI** (true per-pixel refraction like the orb's). Rejected: a second GL context per floating surface is too heavy for menus and toasts, and text inside would leave the DOM. An SVG displacement filter in `backdrop-filter` gives the liquid read at a fraction of the cost.
- **"Gooey" merging** (blur plus an alpha-threshold filter so the Island and its overlays visibly fuse). Rejected: thresholding destroys text anti-aliasing inside the shapes; droplets that bud from their trigger give the same liquid read with crisp text.
- **View Transitions API everywhere.** Preferred in the app where the webview supports it; the two-beat `.view` exit/enter is the fallback and is what the prototype uses.

## Consequences

- Collapsed row forms, like hidden Island variants, must be inert.
- Hidden Island variants must be inert: `visibility: hidden` and disabled controls, so they are never focusable or announced.
- Navigation takes one 160ms exit beat before the next view mounts; anything that measures the old view (the orb flight) must do so in that beat.
- Reduced motion must stay complete: one still orb frame per state, no flight or pulses, instant Island growth, row expands and folds, page swaps, cross-fades and reveals, no lens ripple, sheen, tension, droplet stretch, wave or ambient drift, with status still carried by colour, marks and words.
- The lens ripple is SMIL on the filter (`beginElement()`); where SMIL is unavailable the glass simply stays still.
- The orb’s own tokens (`dur-blend` 460ms, `ease-breathe`, `ease-spring`, `orb-period-*`) keep their original values; changing them is an orb change, not a UI tweak.
