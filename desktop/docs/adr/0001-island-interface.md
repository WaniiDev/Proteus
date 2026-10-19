---
status: accepted
---

# The Island is where you talk to Proteus and where it asks you

The desktop UI moves to direction C, "Island": a light window of floating cards (a sidebar card and one 720px conversation column), with a single dark capsule pinned to the foot of the stage. The Island is the composer, the live run status and the only place Proteus asks for approval, answers or plan sign-off. The orb lives in it once a conversation starts. We chose it over two other directions because it puts "nothing moves without you" in one fixed, unmissable place, and lets the thread stay a plain record of what happened.

The design system that defines it (tokens for Day and Night, Plus Jakarta Sans and JetBrains Mono, the Island, Sidebar, StepList and the rest) is the Proteus design system artifact: https://claude.ai/artifact/LzFK4X4p6i68rg66ANb1yE. The clickable prototype is the "C · Island" board in https://claude.ai/artifact/2WafpTRXhRaTWrj4rNvWQJ. Neither is implemented in `desktop/src/mainview` yet.

## Considered options

- **A · Still**: one light column, no sidebar, the orb inside the composer, approvals as inline cards. Rejected: hiding history behind an icon made switching conversations slow, and inline cards scroll away from the person mid-run.
- **B · Lumen**: dark, a permanent presence panel on the right holding the orb, live steps and approvals. Rejected: a second column costs a third of the window on every screen, and it is a lighter version of the context pane we are removing.
- **C · Island** (chosen).

## Consequences

- Asks never render in the thread. `InteractionCard` (tool approval, `ask_user`, `submit_plan`, recovery) becomes Island content; the thread records the outcome as one resolved line ("Approved · Edit docs/plan.md"). Only one ask shows at a time; others queue.
- The context pane and its tabs go. The live step list moves into the thread; files, search, memory and details move to their own destinations or the conversation menu.
- The 68px nav rail becomes the sidebar card; Projects, Memory and Settings sit at its foot.
- The fonts must be bundled with the app: the desktop CSP allows only `font-src 'self'`.
