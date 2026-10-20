# Browser preview of the renderer

Runs the real renderer in plain Chromium, without Electrobun. `vite.preview.config.ts`
aliases `electrobun/view` to `preview/electrobun-view.ts`, which answers every RPC request
from an in-memory `RuntimeSnapshot` fixture (`preview/fixtures.ts`). Product code is untouched.

Serve (port 5181):

    cd desktop && bun run preview:ui        # same as: bunx vite --config vite.preview.config.ts --port 5181

Open `http://localhost:5181/?scenario=<name>&theme=light|dark`.
Scenarios: `empty`, `thread`, `running`, `ask`, `settings`, `projects`, `long` (default `thread`).
Settings, Projects and the settings tabs are reached by clicking, as in the app.

Screenshot (1280x800, server must be running; `BASE_URL` overrides the origin):

    cd desktop && NODE_PATH=$(npm root -g) node preview/shoot.mjs <outDir> [scenario[:view],...] [--themes=light,dark]

Default list: `empty,thread,running,ask,settings:providers,settings:models,projects:projects,long`, each in light and dark.
`view` is `projects`, `providers`, `models`, `memory` or `developer`. Chromium comes from
`/opt/pw-browsers/chromium` (override with `CHROMIUM=<path>`).

Mutations (select, rename, delete and create thread, model, provider and reasoning select) update the
fixture and push `runtime.changed`; `chat.*` sends are rejected and everything else is a no-op.
`bun test preview` parses every fixture with the contracts' zod schemas.
Dark theme sets `data-theme="dark"` on `<html>`; screens only turn dark once they use the design-system tokens.
