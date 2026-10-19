## Code discovery

Use codebase-memory (the `codebase-memory` skill and `codebase-memory-mcp` tools) first for architecture, symbols, call paths and impact analysis in this project, before grepping or reading files one by one.

- If the project is not indexed yet (`list_projects`), run `index_repository` once. The index refreshes itself, so there is no update step after editing.
- Use `search_graph`, `trace_path` and `get_code_snippet`, and run `check_index_coverage` for every file you rely on.
- Use grep only for literals, configuration and non-code files, and read the exact source before editing.
- Do not use graphify.

## Mastra skill

- Do not send feedback reports to Mastra (the `mastra` skill's "Reporting feedback" / `references/feedback.md` POSTs) unless the user asks for a specific report. Mention a suspected Mastra defect to the user instead.
