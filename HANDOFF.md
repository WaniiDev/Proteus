# Proteus project handoff

_Prepared for the next developer or agent on 2026-08-06. Repository: `WaniiDev/Proteus`, branch: `main`._

## Objective

Proteus is being built as a desktop personal-AI agent harness: one continuous conversation should handle ordinary knowledge work and coding work without a visible mode switch. The product direction is framework-first—use Mastra's native agent, memory, workspace, tools, approval, suspension/resume, task signals, queueing, and provider capabilities instead of recreating those systems in application code.

The immediate expansion goal was to make the normal working-agent experience useful without wasting tool context: exact time, safe calculation, unit conversion, web search, and web fetch, while retaining the existing workspace list/read/grep tools for project inspection.

## Current status

The Mastra-native working-tool expansion is implemented and verified. Codex and OpenRouter now receive provider-appropriate web search, source URLs survive both live and persisted message projection, and citations render after the assistant response. Tool activity UI is compact and semantic, including the final uncommitted-at-start timeline polish now included with this handoff.

The repository is intended to be clean on `main` after this handoff is committed and pushed. The only known verification blocker is native Electrobun packaging: the local dependency installation lacks `desktop/node_modules/electrobun/dist-win-x64/launcher.exe`.

## Done and verified

- Mastra `ToolSearchProcessor` is wired before `NativeToolCallGuard` with `storage: "context"`, `autoLoad: true`, `topK: 3`, and `minScore: 0.1` in `desktop/src/bun/runtime.ts`.
- Mastra's native `webFetchTool` is dynamically discoverable. It retains the framework's public-HTTP-only SSRF protections.
- Always-visible read-only tools `get_datetime`, `calculate`, and `convert_units` live in `desktop/src/bun/working-tools.ts`. Arithmetic is bounded and AST-allowlisted; currency conversion is explicitly unsupported.
- Provider-routed search is native to each provider: Mastra `webSearchTool` for Codex and `@openrouter/ai-sdk-provider`'s `webSearch({ engine: "auto", maxResults: 5 })` for OpenRouter.
- Native AI SDK `source-url` parts are preserved through `desktop/src/bun/native-stream-projection.ts`, `desktop/src/bun/runtime.ts`, and `desktop/src/shared/contracts.ts`; the UI deduplicates and renders them after the answer in `desktop/src/mainview/App.tsx`.
- New tools are included in the approved-plan continuation allowlist and described in the agent instructions and semantic tool timeline.
- The existing workspace inspection set—`list_files`, `read_file`, `file_stat`, and `grep`—remains the local-search solution. A second local-file-search abstraction was intentionally not added because it would duplicate these native workspace tools and increase tool/context surface.
- ToolTimeline polish hides redundant “Tools used” headings for one to three inline calls, removes row chevrons, and uses a reduced-motion-safe spinner for active calls.
- Commits containing the core work:
  - `c2e9fb3 feat: add native working utility tools`
  - `d04e8b2 feat: add provider-native web search citations`
- Verification on 2026-08-06:
  - `bun test`: 168 passed, 0 failed.
  - `bun run typecheck`: passed.
  - Vite production build: passed.
  - `graphify update .`: passed; 928 nodes, 1717 edges, 58 communities, with no tracked graph delta.
  - Focused ToolTimeline test after final UI changes: 8 passed, 0 failed.

## Next actions

1. Repair or reinstall the Electrobun Windows runtime dependency so `desktop/node_modules/electrobun/dist-win-x64/launcher.exe` exists, then run `bun run build` from `desktop/`. Do not weaken `scripts/embed-windows-icons.ts`; it is correctly detecting a missing packaging input.
2. Smoke-test both provider paths in the desktop app:
   - Codex: current-information question should call native `web_search` and show citations.
   - OpenRouter: same behavior through the OpenRouter server tool without changing the selected model.
   - Ask for a public URL to confirm `search_tools` discovers and subsequently exposes `web_fetch`.
3. Continue the working-agent tool backlog only after real usage evidence. Likely next candidates are calendar, reminders/scheduling, and connectors; put larger catalogs behind `ToolSearchProcessor` instead of making every tool always visible.
4. Keep ordinary work and coding capabilities in the same session. Provider selection changes transport/model capability, not the product's visible operating mode.

## Key decisions and rationale

- Mastra installed docs and installed type/source files are the API authority because Mastra changes quickly. Relevant docs: [ToolSearchProcessor](https://mastra.ai/reference/processors/tool-search-processor), [agent tools](https://mastra.ai/docs/agents/using-tools), and [workspace](https://mastra.ai/docs/workspace/overview).
- Core utilities remain always visible because they are cheap, deterministic, and frequently useful. Web fetch is discoverable because it is more specialized and establishes the pattern for future tool catalogs.
- `ToolSearchProcessor` uses context-backed state so discovered tools survive process restarts through durable conversation messages and naturally disappear when the discovery result leaves context.
- Search is provider-native. Do not implement a custom search proxy or silently switch providers/models when search fails.
- Source citations use the native AI SDK `source-url` part rather than parsing URLs out of generated prose.
- Read-only time/math/search/fetch operations do not require approval. Workspace mutations continue through Mastra's native approval flow.
- Local file search was excluded: Mastra workspace list/read/stat/grep already covers exact and content-based project discovery inside the fixed server-owned workspace boundary.

## Risks and gotchas

- No Docker is available on this laptop.
- Native package build currently fails before Electrobun build because `launcher.exe` is absent. Vite compilation itself is healthy.
- `webSearchTool` is a Mastra provider placeholder, while OpenRouter search is an AI SDK provider-defined tool. Do not put either provider-defined search tool inside `ToolSearchProcessor`, whose installed contract accepts Mastra `Tool` instances; only `web_fetch` belongs there today.
- Keep `ToolSearchProcessor` before `NativeToolCallGuard`, otherwise the guard will not see the final dynamically assembled tool catalog.
- Preserve model/provider affinity. A web-search failure must surface as an error and must not reset the remembered provider/model or route through Auto Router.
- The application stores credentials in Windows Credential Manager. Never place API keys or OAuth tokens in diagnostics, handoff files, or repository configuration.
- The workspace root is server-owned and immutable per chat. Do not reintroduce client-supplied arbitrary roots.

## Important files

- `desktop/src/bun/runtime.ts` — Agent construction, provider/model resolution, tool catalog, memory, queue/resume integration, persisted message projection.
- `desktop/src/bun/working-tools.ts` — Date/time, calculator, and unit-conversion tools.
- `desktop/src/bun/native-stream-projection.ts` — Live Mastra chunk-to-UI projection, including citations.
- `desktop/src/bun/plan-workflow-policy.ts` — Tools permitted after plan approval.
- `desktop/src/bun/native-tool-call-guard.ts` — Detects textual imitations of available native tool calls.
- `desktop/src/bun/task-tool-policy.ts` — Prevents repeated task mutations and terminates completed task loops.
- `desktop/src/bun/agent-instructions.ts` — Agent behavior and native-tool discipline.
- `desktop/src/mainview/App.tsx` — Conversation rendering and citation list.
- `desktop/src/mainview/ToolTimeline.tsx` and `desktop/src/mainview/tool-activity.ts` — Tool history presentation.
- `desktop/src/shared/contracts.ts` — Runtime/UI schemas, including `source-url` parts.
- `AGENTS.md` — Repository rules, including mandatory Graphify refresh after code changes.

## Verification and definition of done

From `desktop/`:

```powershell
bun install
bun test
bun run typecheck
bun run build
```

From the repository root after code changes:

```powershell
graphify update .
```

The current working-agent expansion is complete when the full tests and typecheck pass, both provider search paths produce a final answer with deduplicated citations, web fetch is discoverable and blocks private/local targets, the selected provider/model never changes implicitly, and the repaired Electrobun dependency allows the native package build to finish.
